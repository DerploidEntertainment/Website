import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import DnsChallenge from './DnsChallenge';
import * as util from './util';

export interface EmailDnsStackProps extends StackProps {
    /**
     * The domain for which to set up DNSSEC, e.g., "example.com" or "www.example.com".
     * All new DNS records will be added to the hosted zone for this domain.
     * Using an existing zone allows you to easily work with record sets not added by this stack.
     */
    domainName: string;

    /**
     * The value for {@link domainName}'s MX record, indicating the MS Exchange mail server to which incoming emails should be directed.
     */
    exchangeMxValue: string;

    /**
     * TXT values for this domain, primarily for SPF "records".
     * Sendinblue SPF values provided in Sendinblue Dashboard settings > "Senders, Domains, & Dedicated IPs" > Domains tab > "Authenticate this domain" modal.
     * MS Exchange SPF values provided in Microsoft 365 Admin Center > Setup tab > CNAME row under "Microsoft Exchange".
     * If {@link domainName}'s hosted zone already has a root TXT record (possibly managed by a separate CloudFormation stack or created manually),
     * then those values must be copied here (one array element for each line of the record).
     * Otherwise, `cdk deploy` will complain about the TXT record already existng.
     */
    domainTxtValues: string[];

    /**
     * DKIM value provided in Sendinblue Dashboard settings > "Senders, Domains, & Dedicated IPs" > Domains tab > "Authenticate this domain" modal.
     * Domain usually looks like "mail._domainkey.".
     */
    sendinblueDkimChallenge: DnsChallenge;

    /**
     * DMARC policy for email sent by Sendinblue.
     * Sendinblue default is at Sendinblue Dashboard settings > "Senders, Domains, & Dedicated IPs" > Domains tab > "Authenticate this domain" modal.
     * See the {@link https://dmarc.org/overview/ official DMARC overview} or {@link https://datatracker.ietf.org/doc/html/rfc7489#section-6.3 DMARC record format spec}
     * for tags to create a custom DMARC policy.
     */
    dmarcPolicy: string;

    /**
     * Other domains from which DMARC feedback reports can be accepted. Should not include {@link domainName}.
     */
    otherAcceptedDmarcReportDomains: string[];
}

export class EmailDnsStack extends Stack {
    constructor(scope: Construct, id: string, props: EmailDnsStackProps) {
        super(scope, id, props);

        const hostedZone: route53.IHostedZone = route53.HostedZone.fromLookup(this, "WebsiteHostedZone", { domainName: props.domainName });

        new route53.TxtRecord(this, "RootSpf", {
            zone: hostedZone,
            comment: `Assert that Sendinblue and Microsoft Exchange mail servers may send emails for ${props.domainName}`,
            recordName: "",
            values: props.domainTxtValues,
            // ttl: Just use CDK default (30 min currently)
        });

        new route53.TxtRecord(this, "SubdomainSpf", {
            zone: hostedZone,
            comment: `Assert that nothing can send emails for *.${props.domainName}`,
            recordName: "*",
            values: ["v=spf1 -all"],
            // ttl: Just use CDK default (30 min currently)
        });

        new route53.TxtRecord(this, "SendinblueDkim", {
            zone: hostedZone,
            comment: `Sendinblue DKIM public key to authenticate emails from ${props.domainName}`,
            recordName: props.sendinblueDkimChallenge.domain,
            values: [props.sendinblueDkimChallenge.txtValue],
            // ttl: Just use CDK default (30 min currently)
        });
        new route53.TxtRecord(this, "Dmarc", {
            zone: hostedZone,
            comment: `DMARC policy for emails sent from ${props.domainName} via Sendinblue: all emails that fail DKIM or SPF checks should be rejected`,
            recordName: "_dmarc",
            values: [props.dmarcPolicy],
            // ttl: Just use CDK default (30 min currently)
        });
        new route53.TxtRecord(this, "Bimi", {
            zone: hostedZone,
            comment: `BIMI record to show logo on emails sent from ${props.domainName} in email clients`,
            recordName: "default._bimi",
            values: [`v=BIMI1; l=https://www.${props.domainName}/email-logo-v1.tiny-ps.svg; a=;`],  // TODO: Provide an Authority Evidence Location (a=) after registering a trademark for this logo :P
            // ttl: Just use CDK default (30 min currently)
        });

        // Accept DMARC feedback reports from the provided other email domains. See: https://datatracker.ietf.org/doc/html/rfc7489#section-7
        props.otherAcceptedDmarcReportDomains.forEach(domain => {
            new route53.TxtRecord(this, util.domainToPascalCase(domain) + "DmarcReports", {
                zone: hostedZone,
                comment: `DMARC report record to show that DMARC feedback reports for ${domain} may be sent to ${props.domainName}`,
                recordName: `${domain}._report._dmarc`,
                values: ["v=DMARC1"],
                // ttl: Just use CDK default (30 min currently)
            });
        });

        // Add DNS records for Microsoft Exchange
        new route53.MxRecord(this, "ExchangeMx", {
            zone: hostedZone,
            comment: `Use Microsoft Exchange mail server for ${props.domainName}`,
            recordName: "",
            values: [{ priority: 0, hostName: props.exchangeMxValue }],
            ttl: Duration.hours(1), // Recommended by Exchange
        });
        new route53.CnameRecord(this, "ExchangeAutoDiscoverCname", {
            zone: hostedZone,
            comment: `Sendinblue DKIM public key to authenticate emails from ${props.domainName}`,
            recordName: "autodiscover",
            domainName: "autodiscover.outlook.com",
            ttl: Duration.hours(1), // Recommended by Exchange
        });

        // Add DNS records for "Basic Mobility & Security"
        new route53.CnameRecord(this, "ExchangeEnterpriseRegistrationCname", {
            zone: hostedZone,
            comment: `Allow Microsoft Exchange "enterprise registrion" for ${props.domainName}`,
            recordName: "enterpriseregistration",
            domainName: "enterpriseregistration.windows.net",
            ttl: Duration.hours(1), // Recommended by Exchange
        });
        new route53.CnameRecord(this, "ExchangeEnterpriseEnrollmentCname", {
            zone: hostedZone,
            comment: `Allow Microsoft Exchange "enterprise enrollment" for ${props.domainName}`,
            recordName: "enterpriseenrollment",
            domainName: "enterpriseenrollment.manage.microsoft.com",
            ttl: Duration.hours(1), // Recommended by Exchange
        });

    }
}
