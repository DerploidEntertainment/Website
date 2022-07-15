import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import DnsChallenge from './DnsChallenge';

export interface SendinblueDomainAuthorizationProps extends StackProps {
    /**
     * The domain for which to set up DNSSEC, e.g., "example.com" or "www.example.com".
     * All new DNS records will be added to the hosted zone for this domain.
     * Using an existing zone allows you to easily work with record sets not added by this stack.
     */
    domainName: string;

    /**
     * If {@link hostedZoneId} already has a TXT record for {@link domainName} (possibly managed by a separate CloudFormation stack or created manually),
     * then those values must be copied here (one array element for each line of the record).
     * Otherwise, `cdk deploy` will complain about the TXT record already existng.
     */
    priorDomainSpfValues: string[];

    /**
     * SPF value provided in Sendinblue Dashboard settings > "Senders, Domains, & Dedicated IPs" > Domains tab > "Authenticate this domain" modal.
     */
    sendinblueSpfValue: string;

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
     * Domain authorization values provided in Sendinblue Dashboard settings > "Senders, Domains, & Dedicated IPs" > Domains tab > "Authenticate this domain" modal.
     */
    sendinblueDomainAuthorizationTxtValue: string;
}

export class SendinblueDomainAuthorizationStack extends Stack {
    constructor(scope: Construct, id: string, props: SendinblueDomainAuthorizationProps) {
        super(scope, id, props);

        const hostedZone: route53.IHostedZone = route53.HostedZone.fromLookup(this, "WebsiteHostedZone", { domainName: props.domainName });

        new route53.TxtRecord(this, "SendinblueSpf", {
            zone: hostedZone,
            comment: `Assert that Sendinblue's mail servers may send emails for ${props.domainName}`,
            recordName: "",
            values: props.priorDomainSpfValues.concat([
                props.sendinblueSpfValue,
                props.sendinblueDomainAuthorizationTxtValue
            ]),
            // ttl: Just use CDK default (30 min currently)
        });
        new route53.TxtRecord(this, "SendinblueDkim", {
            zone: hostedZone,
            comment: `Sendinblue DKIM public key to authenticate emails from ${props.domainName}`,
            recordName: props.sendinblueDkimChallenge.domain,
            values: [props.sendinblueDkimChallenge.txtValue],
            // ttl: Just use CDK default (30 min currently)
        });
        new route53.TxtRecord(this, "SendinblueDmarc", {
            zone: hostedZone,
            comment: `DMARC policy for emails sent from ${props.domainName} via Sendinblue`,
            recordName: "_dmarc",
            values: [props.dmarcPolicy],
            // ttl: Just use CDK default (30 min currently)
        });
        new route53.TxtRecord(this, "SendinblueBimi", {
            zone: hostedZone,
            comment: `BIMI record to show logo on emails sent from ${props.domainName} in email clients`,
            recordName: "default._bimi",
            values: [`v=BIMI1; l=https://${props.domainName}/email-logo-v1.tiny-ps.svg; a=;`],  // TODO: Provide an Authority Evidence Location (a=) after registering a trademark for this logo :P
            // ttl: Just use CDK default (30 min currently)
        });

    }
}
