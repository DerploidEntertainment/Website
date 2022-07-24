import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';

export interface ExchangeDnsStackProps extends StackProps {
    /**
     * The domain for which to set up DNSSEC, e.g., "example.com" or "www.example.com".
     * All new DNS records will be added to the hosted zone for this domain.
     * Using an existing zone allows you to easily work with record sets not added by this stack.
     */
    domainName: string;

    /**
     * TXT values for this domain, primarily for SPF "records".
     * MS Exchange SPF values provided in Microsoft 365 Admin Center > Setup tab > CNAME row under "Microsoft Exchange".
     * If {@link domainName}'s hosted zone already has a root TXT record (possibly managed by a separate CloudFormation stack or created manually),
     * then those values must be copied here (one array element for each line of the record).
     * Otherwise, `cdk deploy` will complain about the TXT record already existng.
     */
    domainTxtValues: string[];
}

export class ExchangeDnsStack extends Stack {
    constructor(scope: Construct, id: string, props: ExchangeDnsStackProps) {
        super(scope, id, props);

        const hostedZone: route53.IHostedZone = route53.HostedZone.fromLookup(this, "WebsiteHostedZone", { domainName: props.domainName });

        // Add DNS records for Microsoft Exchange
        new route53.MxRecord(this, "ExchangeMx", {
            zone: hostedZone,
            comment: `Use Microsoft Exchange mail server for ${props.domainName}`,
            recordName: "",
            values: [{ priority: 0, hostName: "derploid-com.mail.protection.outlook.com" }],
            ttl: Duration.hours(1), // Recommended by Exchange
        });
        new route53.TxtRecord(this, "ExchangeSpf", {
            zone: hostedZone,
            comment: `Assert that Microsoft Exchange's mail servers may send emails for ${props.domainName}`,
            recordName: "",
            values: props.domainTxtValues,
            ttl: Duration.hours(1), // Recommended by Exchange
        });
        new route53.CnameRecord(this, "SendinblueDkim", {
            zone: hostedZone,
            comment: `Sendinblue DKIM public key to authenticate emails from ${props.domainName}`,
            recordName: "autodiscover",
            domainName: "autodiscover.outlook.com",
            ttl: Duration.hours(1), // Recommended by Exchange
        });

        // Add DNS records for "Basic Mobility & Security"
        new route53.CnameRecord(this, "EnterpriseRegistrationCname", {
            zone: hostedZone,
            comment: `Allow Microsoft Exchange "enterprise registrion" for ${props.domainName}`,
            recordName: "enterpriseregistration",
            domainName: "enterpriseregistration.windows.net",
            ttl: Duration.hours(1), // Recommended by Exchange
        });
        new route53.CnameRecord(this, "EnterpriseEnrollmentCname", {
            zone: hostedZone,
            comment: `Allow Microsoft Exchange "enterprise enrollment" for ${props.domainName}`,
            recordName: "enterpriseenrollment",
            domainName: "enterpriseenrollment.manage.microsoft.com",
            ttl: Duration.hours(1), // Recommended by Exchange
        });

    }
}
