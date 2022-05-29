import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as cf from "aws-cdk-lib/aws-cloudfront";
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
        super(scope, id);

        const hostedZone: route53.IHostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "WebsiteHostedZone", {
            hostedZoneId: props.hostedZoneId,
            zoneName: props.redirectApexDomain,
        });
        const websiteCert = new acm.DnsValidatedCertificate(this, "WebsiteCert", {
            domainName: `www.${props.redirectApexDomain}`,
            hostedZone: hostedZone,
            subjectAlternativeNames: [props.redirectApexDomain],
            validation: acm.CertificateValidation.fromDns(hostedZone),
            cleanupRoute53Records: true,
        });

        const redirectBucket = this.getRedirectBucket("RedirectBucket", "", props);
        const wwwRedirectBucket = this.getRedirectBucket("WwwRedirectBucket", "www.", props);
        const redirectCdn = new cf.CloudFrontWebDistribution(this, "RedirectCdn", {
            comment: `CDN for routing [www.]${props.redirectApexDomain} requests`,
            enabled: true,
            httpVersion: cf.HttpVersion.HTTP1_1,
            enableIpV6: true,
            loggingConfig: {
                bucket: props.logBucket,
                prefix: `${props.redirectApexDomain}-redirect-cdn/`,
                includeCookies: true,
            },
            viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            originConfigs: [
                {
                    behaviors: [
                        {
                            isDefaultBehavior: true,
                            allowedMethods: cf.CloudFrontAllowedMethods.GET_HEAD_OPTIONS,
                            cachedMethods: cf.CloudFrontAllowedCachedMethods.GET_HEAD_OPTIONS,
                        }
                    ],
                    customOriginSource: {
                        domainName: redirectBucket.bucketWebsiteDomainName,
                        originProtocolPolicy: cf.OriginProtocolPolicy.HTTP_ONLY,
                        allowedOriginSSLVersions: [cf.OriginSslPolicy.TLS_V1_2],
                    }
                }
            ],
            priceClass: cf.PriceClass.PRICE_CLASS_100,
            viewerCertificate: cf.ViewerCertificate.fromAcmCertificate(websiteCert, {
                sslMethod: cf.SSLMethod.SNI,
                securityPolicy: cf.SecurityPolicyProtocol.TLS_V1_2_2021,
            }),
        });

        // CDN alias records
        const cdnAliasTarget = route53.RecordTarget.fromAlias(new CloudFrontTarget(redirectCdn));
        new route53.ARecord(this, "RedirectCdnAliasIpv4", {
            zone: hostedZone,
            recordName: "",
            target: cdnAliasTarget,
        });
        new route53.AaaaRecord(this, "RedirectCdnAliasIpv6", {
            zone: hostedZone,
            recordName: "",
            target: cdnAliasTarget,
        });
        new route53.ARecord(this, "WwwRedirectCdnAliasIpv4", {
            zone: hostedZone,
            recordName: "www",
            target: cdnAliasTarget,
        });
        new route53.AaaaRecord(this, "WwwRedirectCdnAliasIpv6", {
            zone: hostedZone,
            recordName: "www",
            target: cdnAliasTarget,
        });

        // Certificate Authority Authorization, so that ONLY ACM can issue certs for ONLY the following domains
        // 60s TTL recommended when associated with a health check (see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-route53-recordset-1.html#cfn-route53-recordset-ttl)
        new route53.CaaAmazonRecord(this, "ApexDomainAmazonCaa", {
            zone: hostedZone,
            recordName: "",
            ttl: Duration.seconds(60),
        });
        new route53.CaaAmazonRecord(this, "WwwAmazonCaa", {
            zone: hostedZone,
            recordName: "www",
            ttl: Duration.seconds(60),
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