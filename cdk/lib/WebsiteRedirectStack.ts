import { RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as cf from "aws-cdk-lib/aws-cloudfront";
import * as cfOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";

export interface WebsiteRedirectProps extends StackProps {
    /**
     * The full domain TO which requests to any of the {@link redirectApexDomains} will be redirected, at which the website is hosted.
     */
    siteDomain: string;
    /**
     * List of domains FROM which website requests will be redirected to {@link siteDomain}.
     * Domains must be apex domains, e.g., "example.com" not "www.example.com".
     * All new DNS records will be added to the hosted zones for these domains.
     * Using existing zones simplifies DNS validation for TLS certificates during stack creation, and allows you to easily work with record sets not added by this stack.
     */
    redirectApexDomains: string[];
    /**
     * ARN of the ACM certificate for the redirect CDN. Must have subject alternative names for all of the {@link redirectApexDomains}.
     */
    redirectTlsCertificateArn: string,
    /**
     * The bucket to which server access logs will be written for the redirect S3 buckets.
     */
    logBucket: s3.IBucket;
}

export class WebsiteRedirectStack extends Stack {
    constructor(scope: Construct, id: string, props: WebsiteRedirectProps) {
        super(scope, id, props);

        const subDomains = ["", "www",];
        const apexDomains = props.redirectApexDomains.map(apex => ({
            domain: apex,
            hostedZone: route53.HostedZone.fromLookup(this, `${this.toPascalCase(apex)}WebsiteHostedZone`, { domainName: apex }),
        }));
        const fqdns = subDomains.flatMap(subDomain => apexDomains.map(apex => {
            const fqdn = (subDomain && subDomain + ".") + apex.domain;
            return {
                fqdn,
                subDomain,
                apexDomain: apex.domain,
                hostedZone: apex.hostedZone,
                resourcePrefix: fqdn.split(".").map(this.toPascalCase).join(""),    // E.g., www.example.com -> WwwExampleCom
            };
        }));

        // Provision "redirect" S3 buckets for apex domain and www subdomain
        const redirectBucket = new s3.Bucket(this, "RedirectBucket", {
            // bucketName: Let CloudFormation create a name for us, so deploys don't fail due to global name conflicts around the world. CloudFormation uses fairly readable defaults anyway
            serverAccessLogsBucket: props.logBucket,
            serverAccessLogsPrefix: "site-redirect-bucket/",
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            websiteRedirect: {
                protocol: s3.RedirectProtocol.HTTPS,
                hostName: props.siteDomain,
            },
            // autoDeleteObjects: bucket will always be empty anyway; no need to provision resources for object auto-deletion
            removalPolicy: RemovalPolicy.DESTROY,
        });

        // Provision CloudFront Distribution to redirect connections over HTTP(S) and IPv4/6
        const redirectCdn = new cf.Distribution(this, "RedirectCdn", {
            enabled: true,
            comment: `CDN for redirecting requests from all "redirect domains" to ${props.siteDomain}, over HTTP(S) and IPv4/6`,
            domainNames: fqdns.map(x => x.fqdn),
            // httpVersion: let CloudFront choose the max HTTP version that connections can use
            enableIpv6: true,
            sslSupportMethod: cf.SSLMethod.SNI,
            // minimumProtocolVersion: let CloudFront choose the minimum version of SLL/TLS required for HTTPS connections
            enableLogging: true,
            logBucket: props.logBucket,
            logFilePrefix: "redirect-cdn/",
            logIncludesCookies: true,
            defaultBehavior: {
                cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED_FOR_UNCOMPRESSED_OBJECTS, // Don't include any query params, cookies, or headers in cache key, and don't bother compressing responses, since we're just redirecting to the main site
                origin: new cfOrigins.S3Origin(redirectBucket, {
                    originShieldRegion: undefined,  // not necessary for these "redirect buckets" since traffic to them will probably stay low as requests are permanently redirected to the main site domain
                    // connectionAttempts: use CloudFront's default (3 currently)
                    // connectionTimeout: use CloudFront's default (10 seconds currently)
                }),
                allowedMethods: cf.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                cachedMethods: cf.CachedMethods.CACHE_GET_HEAD_OPTIONS,
                compress: false,    // Compress automatically compresses CERTAIN file types, not all. Not necessary when just redirecting to the main site
                viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,    // HTTP requests to distribution are permanently redirected to HTTPS
            },
            priceClass: cf.PriceClass.PRICE_CLASS_100,  // We don't need the most global class of CF distribution when redirecting to the main site
            certificate: acm.Certificate.fromCertificateArn(this, "TlsCertificate", props.redirectTlsCertificateArn),
            // TODO: Uncomment this code to define a DNS-validated certificate within this stack, rather than relying on a pre-existing one,
            //       once the `DnsValidatedCertificateProps.validation` field is used by CDK correctly
            // certificate: new acm.DnsValidatedCertificate(this, "TlsCertificate", {
            //     domainName: fqdns[0].fqdn,
            //     hostedZone: fqdns[0].hostedZone,
            //     region: "us-east-1",    // Certificates used for CloudFront distributions must be in us-east-1. This works even if CDK deploys the stack to a different region.
            //     subjectAlternativeNames: fqdns.slice(1).map(x => x.fqdn),
            //     cleanupRoute53Records: true,
            //     validation: acm.CertificateValidation.fromDnsMultiZone(Object.fromEntries(apexDomains.map(x => [x.domain, x.hostedZone]))),
            // }),
            webAclId: undefined,    // We shouldn't need any firewall rules just for redirecting (firewall rules, if any, should exist on the main site)
        });

        // Provision DNS records for apex domain and www subdomain
        const cdnAliasTarget = route53.RecordTarget.fromAlias(new CloudFrontTarget(redirectCdn));
        fqdns.forEach(domain => {
            // CDN alias records
            new route53.ARecord(this, domain.resourcePrefix + "RedirectCdnAliasIpv4", {
                zone: domain.hostedZone,
                comment: `Target ${domain.fqdn} IPv4 traffic to the "redirect CDN"`,
                recordName: domain.subDomain,
                target: cdnAliasTarget,
                // ttl: Must be empty for alias records (https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-route53-recordset.html#cfn-route53-recordset-ttl)
            });
            new route53.AaaaRecord(this, domain.resourcePrefix + "RedirectCdnAliasIpv6", {
                zone: domain.hostedZone,
                comment: `Target ${domain.fqdn} IPv6 traffic to the "redirect CDN"`,
                recordName: domain.subDomain,
                target: cdnAliasTarget,
                // ttl: Must be empty for alias records (https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-route53-recordset.html#cfn-route53-recordset-ttl)
            });

            // Certificate Authority Authorization (CAA)
            // A CAA record on the apex domain would cover all subdomains, but we only want ACM to issue certs for the apex and WWW subdomain
            new route53.CaaAmazonRecord(this, domain.resourcePrefix + "AmazonCaa", {
                zone: domain.hostedZone,
                comment: `Allow ${domain.fqdn} certs to be issued by ACM only`,
                recordName: domain.subDomain,
                // ttl: Just use CDK default (30 min currently)
            });
        });
    }

    private toPascalCase(str: string): string {
        return str[0].toLocaleUpperCase() + str.substring(1);
    }
}