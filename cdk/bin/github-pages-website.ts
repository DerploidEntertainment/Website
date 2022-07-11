#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Aspects, Duration, Environment } from 'aws-cdk-lib';
import { DnssecStack } from '../lib/DnssecStack';
import { GithubPagesOrganizationWebsiteStack } from '../lib/GithubPagesOrganizationWebsiteStack';
import { WebsiteRedirectStack } from '../lib/WebsiteRedirectStack';
import { CdkAppTaggingAspect } from '../lib/CdkAppTaggingAspect';
import { SendinblueDomainAuthorizationStack } from '../lib/SendinblueDomainAuthorizationStack';

// Set up configuration
const TEST_ENV_NAME: string = "test";
const envName: string = process.env.NODE_ENV ?? TEST_ENV_NAME;

const cfgShared = {
    deployRegion: "us-east-2",
    deployAwsAccount: getEnvVariable("DEPLOY_AWS_ACCOUNT"),
    redirectTlsCertificateArn: getEnvVariable("REDIRECT_TLS_CERTIFICATE_ARN"),
    logBucketExpirationDays: 30,

    githubPagesDefaultDomain: "derploidentertainment.github.io",
    githubPagesDnsVerificationDomain: "_github-pages-challenge-DerploidEntertainment",
    githubOrgDnsVerificationDomain: "_github-challenge-derploidentertainment-organization.www",
    githubOrgDnsVerificationTxtValue: "1744185f3c",

    // These values seem to be the same for all domains added to the same Sendinblue account
    sendinblueAuthorizationDkimDomain: "mail._domainkey",
    sendinblueAuthorizationDkimTxtValue: "k=rsa;p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDeMVIzrCa3T14JsNY0IRv5/2V1/v2itlviLQBwXsa7shBD6TrBkswsFUToPyMRWC9tbR/5ey0nRBH0ZVxp+lsmTxid2Y2z+FApQ6ra2VsXfbJP3HE6wAO0YTVEJt1TmeczhEd2Jiz/fcabIISgXEdSpTYJhb0ct0VJRxcg4c8c7wIDAQAB",
    sendinblueAuthorizationSpfTxtValue: "v=spf1 include:spf.sendinblue.com mx ~all",
    sendinblueAuthorizationTxtValue: "Sendinblue-code:ef911d01d3647ff2d2d90d4713cb23ce",
    sendinblueAuthorizationDmarcDomain: "_dmarc",
    sendinblueAuthorizationDmarcTxtValue: "v=DMARC1; p=none; sp=none; rua=mailto:dmarc@mailinblue.com!10m; ruf=mailto:dmarc@mailinblue.com!10m; rf=afrf; pct=100; ri=86400",
};
const cfgEnvSpecific = envName === TEST_ENV_NAME
    ? {
        mainRootDomain: "derploidtest",
        mainTLD: "link",
        redirectTLDs: "click",
        githubPagesDnsVerificationTxtValue: "fc569802644fddf9c602774d3b4683",   // These TXT values aren't secrets b/c they'll end up in DNS anyway
    }
    : {
        mainRootDomain: "derploid",
        mainTLD: "com",
        redirectTLDs: "net,org",
        githubPagesDnsVerificationTxtValue: "0893c0cc6f639a1efa31545928f187",
    };
const cfg = {
    ...cfgShared,
    ...cfgEnvSpecific,
};

// Validate/sanitize configuration
cfg.mainRootDomain = cfg.mainRootDomain.toLowerCase();
cfg.mainTLD = cfg.mainTLD.toLowerCase();
const redirectLowerCaseTLDs = cfg.redirectTLDs.split(",").map(x => x.toLowerCase());

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
    domainName: mainFqdn,
});

// Set up DNS records for Sendinblue domain authorization
new SendinblueDomainAuthorizationStack(app, `${mainDomainPascalCase}${mainTldPascalCase}SendinblueDomainAuthorization`, {
    env: cdkEnv,
    description: `DNS records for ${mainFqdn} for the organization Sendinblue email account`,
    domainName: mainFqdn,
    priorDomainTxtValues: [
        "v=spf1 include:spf.protection.outlook.com -all",
        "v=spf1 include:servers.mcsv.net ?all"
    ],
    sendinblueDomainAuthorizationDkimChallenge: {
        domain: cfg.sendinblueAuthorizationDkimDomain,
        txtValue: cfg.sendinblueAuthorizationDkimTxtValue,
    },
    sendinblueDomainAuthorizationSpfTxtValue: cfg.sendinblueAuthorizationSpfTxtValue,
    sendinblueDomainAuthorizationTxtValue: cfg.sendinblueAuthorizationTxtValue,
    sendinblueDomainAuthorizationDmarcChallenge: {
        domain: cfg.sendinblueAuthorizationDmarcDomain,
        txtValue: cfg.sendinblueAuthorizationDmarcTxtValue,
    },
});

// Set up DNS records and other resources for redirecting provided domains to the "main" domain, with DNSSEC
new WebsiteRedirectStack(app, `${mainDomainPascalCase}WebsiteRedirect`, {
    env: cdkEnv,
    description: `Resources for redirecting requests from "redirect domains" to the organization website at ${mainFqdn}`,
    siteDomain: `www.${mainFqdn}`,
    redirectApexDomains: redirectLowerCaseTLDs.map(tld => `${cfg.mainRootDomain}.${tld}`),
    redirectTlsCertificateArn: cfg.redirectTlsCertificateArn,
    logBucket: githubPagesOrganizationWebsiteStack.logBucket,
});
redirectLowerCaseTLDs
    .forEach(tld => {
        const tldPascalCase = tld[0].toUpperCase() + tld.substring(1);
        const resourcePrefix: string = mainDomainPascalCase + tldPascalCase;
        const fqdn = `${cfg.mainRootDomain}.${tld}`;
        new DnssecStack(app, resourcePrefix + "Dnssec", {
            env: usEast1Env,
            description: `DNSSEC settings for ${fqdn}`,
            domainName: fqdn,
        });
    });


function getEnvVariable(name: string, required: boolean = true): string {
    const value = process.env[name];
    if (required && !value)
        throw new Error(`Required environment variable '${name}' not set`);
    return value ?? "";
}