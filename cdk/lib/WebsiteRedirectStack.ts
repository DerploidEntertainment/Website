import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as cf from "aws-cdk-lib/aws-cloudfront";
import * as cfOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";

export interface WebsiteRedirectProps extends StackProps {
    /**
     * The domain FROM which website requests will be redirected to {@link siteDomain}. Must be an apex domain, e.g., "example.com" not "www.example.com".
     */
    redirectApexDomain: string;
    /**
     * The full domain TO which requests to {@link redirectApexDomain} will be redirected, at which the website is hosted.
     */
    siteDomain: string;
    /**
     * The Route53 hosted zone for the domain at {@link redirectApexDomain}. All new DNS records will be added to that hosted zone.
     * Using an existing zone simplifies DNS validation for TLS certificates during stack creation, and allows you to easily work with record sets not added by this template.
     */
    hostedZoneId: string;
    /**
     * The bucket to which server access logs will be written for the redirect S3 buckets.
     */
    logBucket: s3.IBucket;
}

export class WebsiteRedirectStack extends Stack {
    constructor(scope: Construct, id: string, props: WebsiteRedirectProps) {
        super(scope, id, props);

        const hostedZone: route53.IHostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "WebsiteHostedZone", {
            hostedZoneId: props.hostedZoneId,
            zoneName: props.redirectApexDomain,
        });

        const redirectBucket = this.getRedirectBucket("RedirectBucket", "", props);
        const wwwRedirectBucket = this.getRedirectBucket("WwwRedirectBucket", "www.", props);
        const redirectCdn = new cf.Distribution(this, "RedirectCdn", {
            enabled: true,
            comment: `CDN for redirecting [www.]${props.redirectApexDomain} requests to ${props.siteDomain}, over HTTP(S) and IPv4/6`,
            domainNames: [
                props.redirectApexDomain,
                `www.${props.redirectApexDomain}`,
            ],
            // httpVersion: let CloudFront choose the max HTTP version that connections can use
            enableIpv6: true,
            sslSupportMethod: cf.SSLMethod.SNI,
            // minimumProtocolVersion: let CloudFront choose the minimum version of SLL/TLS required for HTTPS connections
            enableLogging: true,
            logFilePrefix: `${props.redirectApexDomain}-redirect-cdn/`,
            logIncludesCookies: true,
            defaultBehavior: {
                cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED_FOR_UNCOMPRESSED_OBJECTS, // Don't include any query params, cookies, or headers in cache key, and don't bother compressing responses, since we're just redirecting to the main site
                origin: new cfOrigins.S3Origin(redirectBucket, {
                    originShieldRegion: undefined,  // not necessary for these "redirect buckets" since traffic to them will probably stay low as requests are permanently redirected to the main site domain
                    // connectionAttempts: use CloudFront's default (3 at time of coding)
                    // connectionTimeout: use CloudFront's default (10 seconds at time of coding)
                }),
                allowedMethods: cf.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                cachedMethods: cf.CachedMethods.CACHE_GET_HEAD_OPTIONS,
                compress: false,    // Compress automatically compresses CERTAIN file types, not all. Not necessary when just redirecting to the main site
                viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,    // HTTP requests to distribution are permanently redirected to HTTPS
            },
            priceClass: cf.PriceClass.PRICE_CLASS_100,  // We don't need the most global class of CF distribution when redirecting to the main site
            certificate: new acm.DnsValidatedCertificate(this, 'TlsCertificate', {
                domainName: `www.${props.redirectApexDomain}`,
                hostedZone: hostedZone,
                region: "us-east-1",    // Certificates used for CloudFront distributions must be in us-east-1. This works even if CDK deploys the stack to a different region.
                subjectAlternativeNames: [props.redirectApexDomain],
                cleanupRoute53Records: true,
            }),
            webAclId: undefined,    // We shouldn't need any firewall rules just for redirecting (firewall rules, if any, should exist on the main site)
        });

        // 60s TTL recommended for records associated with a health check: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-route53-recordset.html#cfn-route53-recordset-ttl
        const dnsTtl = Duration.seconds(60);

        // CDN alias records
        const cdnAliasTarget = route53.RecordTarget.fromAlias(new CloudFrontTarget(redirectCdn));
        new route53.ARecord(this, "RedirectCdnAliasIpv4", {
            zone: hostedZone,
            comment: `Target ${props.redirectApexDomain} IPv4 traffic to the "redirect CDN"`,
            ttl: dnsTtl,
            recordName: "",
            target: cdnAliasTarget,
        });
        new route53.AaaaRecord(this, "RedirectCdnAliasIpv6", {
            zone: hostedZone,
            comment: `Target ${props.redirectApexDomain} IPv6 traffic to the "redirect CDN"`,
            ttl: dnsTtl,
            recordName: "",
            target: cdnAliasTarget,
        });
        new route53.ARecord(this, "WwwRedirectCdnAliasIpv4", {
            zone: hostedZone,
            comment: `Target www.${props.redirectApexDomain} IPv4 traffic to the "redirect CDN"`,
            ttl: dnsTtl,
            recordName: "www",
            target: cdnAliasTarget,
        });
        new route53.AaaaRecord(this, "WwwRedirectCdnAliasIpv6", {
            zone: hostedZone,
            comment: `Target www.${props.redirectApexDomain} IPv6 traffic to the "redirect CDN"`,
            ttl: dnsTtl,
            recordName: "www",
            target: cdnAliasTarget,
        });

        // Certificate Authority Authorization (CAA)
        new route53.CaaAmazonRecord(this, "ApexDomainAmazonCaa", {
            zone: hostedZone,
            comment: `Only allow ACM to issue certs for ${props.redirectApexDomain}`,
            ttl: dnsTtl,
            recordName: "",
        });
        new route53.CaaAmazonRecord(this, "WwwAmazonCaa", {
            zone: hostedZone,
            comment: `Only allow ACM to issue certs for www.${props.redirectApexDomain}`,
            ttl: dnsTtl,
            recordName: "www",
        });
    }


    private getRedirectBucket(id: string, subDomain: string, props: WebsiteRedirectProps): s3.Bucket {
        return new s3.Bucket(this, id, {
            bucketName: `${subDomain}${props.redirectApexDomain}`,
            serverAccessLogsBucket: props.logBucket,
            serverAccessLogsPrefix: `${subDomain}${props.redirectApexDomain}/`,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            websiteRedirect: {
                protocol: s3.RedirectProtocol.HTTPS,
                hostName: props.siteDomain,
            },
            autoDeleteObjects: true,
            removalPolicy: RemovalPolicy.DESTROY,
        });
    }
}