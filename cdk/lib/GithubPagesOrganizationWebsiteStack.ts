import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as route53 from 'aws-cdk-lib/aws-route53';

export interface GithubPagesOrganizationWebsiteProps extends StackProps {
    /**
     * The domain at which the website is hosted. Must be an apex domain, e.g., "example.com" not "www.example.com".
     */
    apexDomainName: string;

    /**
     * The Route53 hosted zone for the domain at {@link apexDomainName}. All new DNS records will be added to that hosted zone.
     * Using an existing zone simplifies DNS validation for TLS certificates during stack creation, and allows you to easily work with record sets not added by this template.
     */
    hostedZoneId: string;

    /**
     * The Duration, in days, until log entries expire from the log bucket. Default is to never expire.
     */
    logBucketExpiration?: Duration;

    /**
     * The GitHub Pages default domain to which the DNS CNAME record for your root domain will point.
     * For more info, see {@link https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site#configuring-an-apex-domain-and-the-www-subdomain-variant the docs}.
     */
    githubPagesDefaultDomain: string;

    /**
     * Values provided in GitHub repo Settings when adding a new verified domain.
     * Domain usually looks like "_github-pages-challenge-<ExampleOrganization>".
     * For more info, see {@link https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages the docs}.
     */
    githubPagesDnsVerificationChallenge: GithubDnsVerificationChallenge;

    /**
     * Values provided in GitHub organization Settings when adding a new verified domain.
     * Domain usually looks like "_github-challenge-<ExampleOrganization>-organization.www".
     * For more info, see {@link https://docs.github.com/en/enterprise-server@3.2/admin/configuration/configuring-your-enterprise/verifying-or-approving-a-domain-for-your-enterprise#verifying-a-domain-for-your-enterprise-account the docs}.
     */
    githubOrganizationDnsVerificationChallenge: GithubDnsVerificationChallenge;
}

export class GithubDnsVerificationChallenge {
    /**
     * Domain name of the DNS TXT record used by GitHub for domain verification.
     */
    domain: string;

    /**
     * Value to use in the root domain's DNS TXT record for GitHub organization domain verification. Do NOT include surrounding quotes.
     * This value will be visible to any DNS client, so it need not be kept secret from version control.
     */
    txtValue: string;
}

export class GithubPagesOrganizationWebsiteStack extends Stack {
    /**
     * The S3 bucket for storing CloudFront and S3 server access logs.
     */
    readonly logBucket: s3.Bucket;

    constructor(scope: Construct, id: string, props: GithubPagesOrganizationWebsiteProps) {
        super(scope, id);

        this.logBucket = new s3.Bucket(this, "LogBucket", {
            accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
            // bucketName: Let CloudFormation create a name for us, so deploys don't fail due to global name conflicts around the world. CloudFormation uses fairly readable defaults anyway
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            lifecycleRules: [
                {
                    id: "expire-logs",
                    expiration: props.logBucketExpiration,
                    enabled: true,
                }
            ],
        });

        new route53.CfnRecordSetGroup(this, "RecordSetGroup", {
            comment: "Record sets to route traffic to the GitHub Pages website",
            hostedZoneId: props.hostedZoneId,
            recordSets: [
                {
                    // Allow GitHub to verify ownership of this domain
                    name: `${props.githubPagesDnsVerificationChallenge.domain}.${props.apexDomainName}`,
                    ttl: "300",
                    type: "TXT",
                    resourceRecords: [`"${props.githubPagesDnsVerificationChallenge.txtValue}"`], // Quotes required for TXT, see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html#TXTFormat
                },
                {
                    // Allow GitHub to verify ownership of WWW subdomain
                    name: `${props.githubOrganizationDnsVerificationChallenge.domain}.${props.apexDomainName}`,
                    ttl: "300",
                    type: "TXT",
                    resourceRecords: [`"${props.githubOrganizationDnsVerificationChallenge.txtValue}"`], // Quotes required for TXT, see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/ResourceRecordTypes.html#TXTFormat
                },
                {
                    // GitHub Pages apex domain IPv4 records (see https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site#configuring-an-apex-domain)
                    name: props.apexDomainName,
                    ttl: "300",
                    type: "A",
                    resourceRecords: [
                        "185.199.108.153",
                        "185.199.109.153",
                        "185.199.110.153",
                        "185.199.111.153",
                    ],
                },
                {
                    // GitHub Pages apex domain IPv6 records (see https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site#configuring-an-apex-domain)
                    name: props.apexDomainName,
                    ttl: "300",
                    type: "AAAA",
                    resourceRecords: [
                        "2606:50c0:8000::153",
                        "2606:50c0:8001::153",
                        "2606:50c0:8002::153",
                        "2606:50c0:8003::153",
                    ],
                },
                {
                    // GitHub Pages subdomain, so apex domain requests redirect to subdomain (see https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site#configuring-an-apex-domain)
                    name: `www.${props.apexDomainName}`,
                    ttl: "300",
                    type: "CNAME",
                    resourceRecords: [props.githubPagesDefaultDomain],
                },
                {
                    // Certificate Authority Authorization, so that ONLY the following orgs can issue certs for ONLY the following domains
                    // We don't need a CAA record for the www subdomain b/c it has a CNAME record, so it's not allowed to have any other records (see https://letsencrypt.org/docs/caa/#where-to-put-the-record).
                    // 60s TTL recommended when associated with a health check (see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-route53-recordset-1.html#cfn-route53-recordset-ttl)
                    // Quotes around domains required
                    name: props.apexDomainName,
                    ttl: "60",
                    type: "CAA",
                    resourceRecords: [
                        '0 issue "amazon.com"',
                        '0 issue "amazontrust.com"',
                        '0 issue "awstrust.com"',
                        '0 issue "amazonaws.com"',
                        '0 issue "letsencrypt.org"',
                    ],
                },
            ]
        });
    }
}
