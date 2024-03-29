#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Aspects, Duration, Environment } from 'aws-cdk-lib';
import { DnssecStack } from '../lib/DnssecStack';
import { GithubPagesOrganizationWebsiteStack } from '../lib/GithubPagesOrganizationWebsiteStack';
import { WebsiteRedirectStack } from '../lib/WebsiteRedirectStack';
import { CdkAppTaggingAspect } from '../lib/CdkAppTaggingAspect';
import { EmailDnsStack } from '../lib/EmailDnsStack';
import { HealthCheckAlarmStack } from '../lib/HealthCheckAlarmStack';

// Set up configuration
const TEST_ENV_NAME: string = "test";
const envName: string = process.env.NODE_ENV ?? TEST_ENV_NAME;

const dmarcReportRuaEmail = getEnvVariable("DMARC_REPORT_RUA_EMAIL");
const dmarcReportRufEmail = getEnvVariable("DMARC_REPORT_RUF_EMAIL");

const cfgShared = {
    deployRegion: "us-east-2",
    deployAwsAccount: getEnvVariable("DEPLOY_AWS_ACCOUNT"),
    redirectTlsCertificateArn: getEnvVariable("REDIRECT_TLS_CERTIFICATE_ARN"),
    dnssecAlarmSubscribeEmails: getEnvVariable("DNSSEC_ALARM_SUBSCRIBE_EMAILS").split(","),
    healthCheckAlarmSubscribeEmails: getEnvVariable("HEALTH_CHECK_ALARM_SUBSCRIBE_EMAILS").split(","),
    logBucketExpirationDays: 30,

    githubPagesDefaultDomain: "derploidentertainment.github.io",
    githubPagesDnsVerificationDomain: "_github-pages-challenge-DerploidEntertainment",
    githubOrgDnsVerificationDomain: "_github-challenge-derploidentertainment-organization.www",
    githubOrgDnsVerificationTxtValue: "1744185f3c",

    sendinblueDkimDomain: "mail._domainkey",
    sendinblueDkimValue: "k=rsa;p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDeMVIzrCa3T14JsNY0IRv5/2V1/v2itlviLQBwXsa7shBD6TrBkswsFUToPyMRWC9tbR/5ey0nRBH0ZVxp+lsmTxid2Y2z+FApQ6ra2VsXfbJP3HE6wAO0YTVEJt1TmeczhEd2Jiz/fcabIISgXEdSpTYJhb0ct0VJRxcg4c8c7wIDAQAB",
    dmarcPolicy: "v=DMARC1;" +  // Values documented at https://dmarc.org/overview/ or https://datatracker.ietf.org/doc/html/rfc7489#section-6.3
        "p=reject;" +           // Reject emails that fail DMARC validation; i.e., don't even show them in spam folders
        "adkim=s;aspf=s;" +     // DKIM and SPF domains must both be identical to email From domain

        // Feedback report settings, so we get notified if someone is trying to spoof this domain in email
        "rf=afrf;" +        // Failure report format
        `rua=mailto:${dmarcReportRuaEmail};` +  // Where to send aggregate feedback reports (and max size). Not secrect since this will end up in DNS anyway
        "ri=3600;" +        // How often to send aggregate feedback reports (some mailbox providers may throttle to daily)
        `ruf=mailto:${dmarcReportRufEmail};` +   // Where to send message-specific failure reports (and max size). Not secrect since this will end up in DNS anyway
        "fo=1;",            // Report message-specific failure due to SPF- or DKIM-validation
};
const cfgTest = {
    mainRootDomain: "derploidtest",
    mainTLD: "link",
    redirectTLDs: ["click"],
    githubPagesDnsVerificationTxtValue: "fc569802644fddf9c602774d3b4683",   // These TXT values aren't secrets b/c they'll end up in DNS anyway
    exchangeMxValue: "derploidtest-link.mail.protection.outlook.com",
};
const cfgProd = {
    mainRootDomain: "derploid",
    mainTLD: "com",
    redirectTLDs: ["net", "org"],
    githubPagesDnsVerificationTxtValue: "0893c0cc6f639a1efa31545928f187",
    exchangeMxValue: "derploid-com.mail.protection.outlook.com",
};
const isTestEnv = envName === TEST_ENV_NAME;
const cfgEnvSpecific = isTestEnv ? cfgTest : cfgProd;
const cfg = {
    ...cfgShared,
    ...cfgEnvSpecific,
};

// Validate/sanitize configuration
cfg.mainRootDomain = cfg.mainRootDomain.toLowerCase();
cfg.mainTLD = cfg.mainTLD.toLowerCase();

// Define CDK environments for stacks
const cdkEnv: Environment = {   // Set CDK environment according to AWS CLI profile passed to CDK CLI (see https://docs.aws.amazon.com/cdk/v2/guide/environments.html)
    account: cfg.deployAwsAccount,
    region: cfg.deployRegion,
};
const usEast1Env: Environment = {
    account: cfg.deployAwsAccount,
    region: "us-east-1",    // Some resources require this region
};

const app = new cdk.App();

Aspects.of(app).add(new CdkAppTaggingAspect(`${cfg.mainRootDomain}-website`));

// Set up DNS records for GitHub Pages website on main domain with DNSSEC.
// We need not define a TLS certificate, as GitHub Pages will create one for us.
const mainDomainPascalCase = cfg.mainRootDomain[0].toUpperCase() + cfg.mainRootDomain.substring(1);
const mainTldPascalCase = cfg.mainTLD[0].toUpperCase() + cfg.mainTLD.substring(1);
const mainFqdn = `${cfg.mainRootDomain}.${cfg.mainTLD}`;
const githubPagesOrganizationWebsiteStack = new GithubPagesOrganizationWebsiteStack(app, `${mainDomainPascalCase}GithubPagesOrganizationWebsite`, {
    env: cdkEnv,
    description: `Resources and DNS settings for hosting the organization website at ${mainFqdn} with GitHub Pages`,
    terminationProtection: !isTestEnv,
    apexDomainName: mainFqdn,
    logBucketExpiration: cfg.logBucketExpirationDays ? Duration.days(cfg.logBucketExpirationDays) : undefined,
    githubPagesDefaultDomain: cfg.githubPagesDefaultDomain,
    githubPagesDnsVerificationChallenge: {
        domain: cfg.githubPagesDnsVerificationDomain,
        txtValue: cfg.githubPagesDnsVerificationTxtValue,
    },
    githubOrganizationDnsVerificationChallenge: {
        domain: cfg.githubOrgDnsVerificationDomain,
        txtValue: cfg.githubOrgDnsVerificationTxtValue,
    },
});
new DnssecStack(app, `${mainDomainPascalCase}${mainTldPascalCase}Dnssec`, {
    env: usEast1Env,
    description: `DNSSEC settings for the organization website at ${mainFqdn}`,
    terminationProtection: !isTestEnv,
    domainName: mainFqdn,
    alarmSubscribeEmails: cfg.dnssecAlarmSubscribeEmails,
});

// Set up DNS records for Sendinblue and MS Exchange to authorize domains and send emails
const mainDomainTxtValues = [
    // This "SPF record" combines the following records for MS Outlook and Sendinblue,
    // as suggested here https://www.mailerlite.com/help/how-to-merge-spf-records)
    //      "v=spf1 include:spf.protection.outlook.com -all",
    //      "v=spf1 include:spf.sendinblue.com mx ~all",
    "v=spf1 mx include:spf.protection.outlook.com include:spf.sendinblue.com -all",
    "Sendinblue-code:ef911d01d3647ff2d2d90d4713cb23ce",    // Apparently same for all domains authorized by same Sendinblue account
];
new EmailDnsStack(app, `${mainDomainPascalCase}${mainTldPascalCase}EmailDns`, {
    env: cdkEnv,
    description: `DNS records on ${mainFqdn} for Sendinblue and Microsoft Exchange mail servers`,
    terminationProtection: !isTestEnv,
    domainName: mainFqdn,
    exchangeMxValue: cfg.exchangeMxValue,
    domainTxtValues: mainDomainTxtValues,
    sendinblueDkimChallenge: {
        domain: cfg.sendinblueDkimDomain,
        txtValue: cfg.sendinblueDkimValue,
    },
    dmarcPolicy: cfg.dmarcPolicy,
    otherAcceptedDmarcReportDomains:
        isTestEnv
            ? []
            : [`${cfgTest.mainRootDomain}.${cfgTest.mainTLD}`]
                .concat(cfgTest.redirectTLDs.map(tld => `${cfgTest.mainRootDomain}.${tld}`))
                .concat(cfgProd.redirectTLDs.map(tld => `${cfgProd.mainRootDomain}.${tld}`)),
});

// Set up DNS records and other resources for redirecting provided domains to the "main" domain, with DNSSEC
new WebsiteRedirectStack(app, `${mainDomainPascalCase}WebsiteRedirect`, {
    env: cdkEnv,
    description: `Resources for redirecting requests from "redirect domains" to the organization website at ${mainFqdn}`,
    terminationProtection: !isTestEnv,
    siteDomain: `www.${mainFqdn}`,
    redirectApexDomains: cfg.redirectTLDs.map(tld => `${cfg.mainRootDomain}.${tld}`),
    redirectTlsCertificateArn: cfg.redirectTlsCertificateArn,
    logBucket: githubPagesOrganizationWebsiteStack.logBucket,
    dmarcPolicy: cfg.dmarcPolicy,
});
cfg.redirectTLDs
    .forEach(tld => {
        const tldPascalCase = tld[0].toUpperCase() + tld.substring(1);
        const resourcePrefix: string = mainDomainPascalCase + tldPascalCase;
        const fqdn = `${cfg.mainRootDomain}.${tld}`;
        new DnssecStack(app, resourcePrefix + "Dnssec", {
            env: usEast1Env,
            description: `DNSSEC settings for ${fqdn}`,
            terminationProtection: !isTestEnv,
            domainName: fqdn,
            alarmSubscribeEmails: cfg.dnssecAlarmSubscribeEmails,
        });
    });

// Set up health checks and alarms for the main website and its redirect domains
new HealthCheckAlarmStack(app, `${mainDomainPascalCase}HealthCheckAlarms`, {
    env: usEast1Env,
    description: `Health checks and alarms for monitoring the organization website at ${mainFqdn}, and its various "redirect domains"`,
    terminationProtection: !isTestEnv,
    mainApexDomain: mainFqdn,
    redirectApexDomains: cfg.redirectTLDs.map(tld => `${cfg.mainRootDomain}.${tld}`),
    mainDomainHealthCheckStatusMetricPeriod: Duration.minutes(1),
    redirectDomainsHealthCheckStatusMetricPeriod: Duration.minutes(5),
    healthCheckAlarmSubscribeEmails: cfg.healthCheckAlarmSubscribeEmails,
});


function getEnvVariable(name: string, required: boolean = true): string {
    const value = process.env[name];
    if (required && !value)
        throw new Error(`Required environment variable '${name}' not set`);
    return value ?? "";
}