import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as route53 from 'aws-cdk-lib/aws-route53';
import DnsChallenge from "./DnsChallenge";

export interface GithubPagesOrganizationWebsiteProps extends StackProps {
    /**
     * The domain at which the website is hosted. Must be an apex domain, e.g., "example.com" not "www.example.com".
     * All new DNS records will be added to the hosted zone for this domain.
     * Using an existing zone allows you to easily work with record sets not added by this stack.
     */
    apexDomainName: string;

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
     * If {@link domainName}'s hosted zone already has a root TXT record (possibly managed by a separate CloudFormation stack or created manually),
     * then those values must be copied here (one array element for each line of the record).
     * Otherwise, `cdk deploy` will complain about the TXT record already existing.
     */
    domainTxtValues: string[];

    /**
     * Values provided in GitHub repo Settings when adding a new verified domain.
     * Domain usually looks like "_github-pages-challenge-<ExampleOrganization>".
     * For more info, see {@link https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages the docs}.
     */
    githubPagesDnsVerificationChallenge: DnsChallenge;

    /**
     * Values provided in GitHub organization Settings when adding a new verified domain.
     * Domain usually looks like "_github-challenge-<ExampleOrganization>-organization.www".
     * For more info, see {@link https://docs.github.com/en/enterprise-server@3.2/admin/configuration/configuring-your-enterprise/verifying-or-approving-a-domain-for-your-enterprise#verifying-a-domain-for-your-enterprise-account the docs}.
     */
    githubOrganizationDnsVerificationChallenge: DnsChallenge;
}

export class GithubPagesOrganizationWebsiteStack extends Stack {
    /**
     * The S3 Bucket for storing CloudFront and S3 server access logs.
     */
    public readonly logBucket: s3.Bucket;

    constructor(scope: Construct, id: string, props: GithubPagesOrganizationWebsiteProps) {
        super(scope, id, props);

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
            autoDeleteObjects: true,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        const hostedZone: route53.IHostedZone = route53.HostedZone.fromLookup(this, "WebsiteHostedZone", { domainName: props.apexDomainName });

        new route53.TxtRecord(this, "RootTxt", {
            zone: hostedZone,
            comment: `Add DNS verification for domain-based services like Brevo, Microsoft Exchange, Google Search, etc. for ${props.apexDomainName}`,
            recordName: "",
            values: props.domainTxtValues,
            // ttl: Just use CDK default (30 min currently)
        });

        // DNS TXT records for GitHub to verify domain ownership
        new route53.TxtRecord(this, "GitHubPagesVerifyDomain", {
            zone: hostedZone,
            comment: `Allow GitHub Pages to verify ownership of ${props.apexDomainName}`,
            recordName: props.githubPagesDnsVerificationChallenge.domain,
            values: [props.githubPagesDnsVerificationChallenge.txtValue],
            // ttl: Just use CDK default (30 min currently)
        });
        new route53.TxtRecord(this, "GithubOrganizationVerifyDomain", {
            zone: hostedZone,
            comment: `Allow GitHub Organizations to verify ownership of ${props.apexDomainName}`,
            recordName: props.githubOrganizationDnsVerificationChallenge.domain,
            values: [props.githubOrganizationDnsVerificationChallenge.txtValue],
            // ttl: Just use CDK default (30 min currently)
        });

        // DNS records to point domains at GitHub Pages servers
        // See GitHub Pages apex domain IPv4/6 values: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site#configuring-an-apex-domain
        new route53.ARecord(this, "GithubPagesIpv4", {
            zone: hostedZone,
            comment: `Target ${props.apexDomainName} IPv4 traffic to GitHub Pages servers`,
            recordName: "",
            target: route53.RecordTarget.fromValues(
                "185.199.108.153",
                "185.199.109.153",
                "185.199.110.153",
                "185.199.111.153",
            ),
            // ttl: Just use CDK default (30 min currently)
        });
        new route53.AaaaRecord(this, "GithubPagesIpv6", {
            zone: hostedZone,
            comment: `Target ${props.apexDomainName} IPv6 traffic to GitHub Pages servers`,
            recordName: "",
            target: route53.RecordTarget.fromValues(
                "2606:50c0:8000::153",
                "2606:50c0:8001::153",
                "2606:50c0:8002::153",
                "2606:50c0:8003::153",
            ),
            // ttl: Just use CDK default (30 min currently)
        });
        new route53.CnameRecord(this, "GithubPagesCname", {
            zone: hostedZone,
            comment: `Map www.${props.apexDomainName} to GitHub Pages domain`,
            recordName: "www",
            domainName: props.githubPagesDefaultDomain,
            // ttl: Just use CDK default (30 min currently)
        });

        // Certificate Authority Authorization (CAA)
        // We don't need a CAA record for the www subdomain b/c it has a CNAME record, so it's not allowed to have any other records (see https://letsencrypt.org/docs/caa/#where-to-put-the-record).
        new route53.CaaRecord(this, "LetsEncryptCaa", {
            zone: hostedZone,
            comment: `Allow ${props.apexDomainName} certs to be issued by Let's Encrypt only`,
            recordName: "",
            values: [
                { flag: 0, tag: route53.CaaTag.ISSUE, value: "letsencrypt.org" },
            ],
            // ttl: Just use CDK default (30 min currently)
        });
    }
}
