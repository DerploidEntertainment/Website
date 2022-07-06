import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import DnsChallenge from './DnsChallenge';

export interface SendinblueDomainAuthorizationProps extends StackProps {
    /**
     * The domain for which to set up DNSSEC, e.g., "example.com" or "www.example.com".
     */
    domainName: string;

    /**
     * The Route53 hosted zone for {@link domainName}. All new DNS records will be added to that hosted zone.
     * Using an existing zone allows you to easily work with record sets not added by this stack.
     */
    hostedZoneId: string;

    /**
     * If {@link hostedZoneId} already has a TXT record for {@link domainName} (possibly managed by a separate CloudFormation stack or created manually),
     * then those values must be copied here (one array element for each line of the record).
     * Otherwise, `cdk deploy` will complain about the TXT record already existng.
     */
    priorDomainTxtValues: string[];

    /**
     * DKIM values provided in Sendinblue Dashboard settings > "Senders, Domains, & Dedicated IPs" > Domains tab > "Authenticate this domain" modal.
     * Domain usually looks like "mail._domainkey.".
     */
    sendinblueDomainAuthorizationDkimChallenge: DnsChallenge;

    /**
     * SPF values provided in Sendinblue Dashboard settings > "Senders, Domains, & Dedicated IPs" > Domains tab > "Authenticate this domain" modal.
     */
    sendinblueDomainAuthorizationSpfTxtValue: string;

    /**
     * Domain authorization values provided in Sendinblue Dashboard settings > "Senders, Domains, & Dedicated IPs" > Domains tab > "Authenticate this domain" modal.
     */
    sendinblueDomainAuthorizationTxtValue: string;

    /**
     * DMARC values provided in Sendinblue Dashboard settings > "Senders, Domains, & Dedicated IPs" > Domains tab > "Authenticate this domain" modal.
     * Domain usually looks like "_dmarc.".
     */
    sendinblueDomainAuthorizationDmarcChallenge: DnsChallenge;
}

export class SendinblueDomainAuthorizationStack extends Stack {
    constructor(scope: Construct, id: string, props: SendinblueDomainAuthorizationProps) {
        super(scope, id, props);

        const hostedZone: route53.IHostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "WebsiteHostedZone", {
            hostedZoneId: props.hostedZoneId,
            zoneName: props.domainName,
        });

        new route53.TxtRecord(this, "SendinblueAuthorizeDomainDkim", {
            zone: hostedZone,
            comment: `Allow Sendinblue to authorize ${props.domainName}`,
            recordName: props.sendinblueDomainAuthorizationDkimChallenge.domain,
            values: [props.sendinblueDomainAuthorizationDkimChallenge.txtValue],
            // ttl: Just use CDK default (30 min currently)
        });
        new route53.TxtRecord(this, "SendinblueAuthorizeDomainSpf", {
            zone: hostedZone,
            comment: `Allow Sendinblue to authorize ${props.domainName}`,
            recordName: "",
            values: props.priorDomainTxtValues.concat([
                props.sendinblueDomainAuthorizationSpfTxtValue,
                props.sendinblueDomainAuthorizationTxtValue
            ]),
            // ttl: Just use CDK default (30 min currently)
        });
        new route53.TxtRecord(this, "SendinblueAuthorizeDomainDmarc", {
            zone: hostedZone,
            comment: `Allow Sendinblue to authorize ${props.domainName}`,
            recordName: props.sendinblueDomainAuthorizationDmarcChallenge.domain,
            values: [props.sendinblueDomainAuthorizationDmarcChallenge.txtValue],
            // ttl: Just use CDK default (30 min currently)
        });

    }
}
