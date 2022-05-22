import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as cf from "aws-cdk-lib/aws-cloudfront";
import * as s3 from "aws-cdk-lib/aws-s3";

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

        const redirectBucket = new s3.Bucket(this, "RedirectBucket", {
            bucketName: props.redirectApexDomain,
            serverAccessLogsBucket: props.logBucket,
            serverAccessLogsPrefix: `${props.redirectApexDomain}/`,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            websiteRedirect: {
                protocol: s3.RedirectProtocol.HTTPS,
                hostName: props.siteDomain,
            },
        });
        const wwwRedirectBucket = new s3.Bucket(this, "WwwRedirectBucket", {
            bucketName: `www.${props.redirectApexDomain}`,
            serverAccessLogsBucket: props.logBucket,
            serverAccessLogsPrefix: `www.${props.redirectApexDomain}/`,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            websiteRedirect: {
                protocol: s3.RedirectProtocol.HTTPS,
                hostName: props.siteDomain,
            },
        });
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

        const cdnAliasTarget = {
            dnsName: redirectCdn.distributionDomainName,
            hostedZoneId: "Z2FDTNDATAQYW2",
            evaluateTargetHealth: false,
        };
        new route53.CfnRecordSetGroup(this, "RecordSetGroup", {
            comment: "Record sets to route traffic to the website domain",
            hostedZoneId: props.hostedZoneId,
            recordSets: [
                // CDN alias records
                // TTL must be omitted for alias records, see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-route53-recordset.html#cfn-route53-recordset-ttl
                {
                    name: props.redirectApexDomain,
                    type: "A",
                    aliasTarget: cdnAliasTarget,
                },
                {
                    name: props.redirectApexDomain,
                    type: "AAAA",
                    aliasTarget: cdnAliasTarget,
                },
                {
                    name: `www.${props.redirectApexDomain}`,
                    type: "A",
                    aliasTarget: cdnAliasTarget,
                },
                {
                    name: `www.${props.redirectApexDomain}`,
                    type: "AAAA",
                    aliasTarget: cdnAliasTarget,
                },
                // Certificate Authority Authorization, so that ONLY ACM can issue certs for ONLY the following domains
                // 60s TTL recommended when associated with a health check (see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-route53-recordset-1.html#cfn-route53-recordset-ttl)
                // Quotes around domains required
                {
                    name: props.redirectApexDomain,
                    type: "CAA",
                    ttl: "60",
                    resourceRecords: [
                        '0 issue "amazon.com"',
                        '0 issue "amazontrust.com"',
                        '0 issue "awstrust.com"',
                        '0 issue "amazonaws.com"',
                    ]
                },
                {
                    name: `www.${props.redirectApexDomain}`,
                    type: "CAA",
                    ttl: "60",
                    resourceRecords: [
                        '0 issue "amazon.com"',
                        '0 issue "amazontrust.com"',
                        '0 issue "awstrust.com"',
                        '0 issue "amazonaws.com"',
                    ]
                },
            ]
        });
    }
}