#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Aspects, Duration, Environment } from 'aws-cdk-lib';
import { DnssecStack } from '../lib/DnssecStack';
import { GithubPagesOrganizationWebsiteStack } from '../lib/GithubPagesOrganizationWebsiteStack';
import { WebsiteRedirectStack } from '../lib/WebsiteRedirectStack';
import { CdkAppTaggingAspect } from '../lib/CdkAppTaggingAspect';

import * as testSecretEnv from "../cfg/cfg.test.secret.json";
import * as prodSecretEnv from "../cfg/cfg.prod.secret.json";

// Set up configuration
const envName: string = process.env.NODE_ENV ?? "test";

const cfgShared = {
    deployRegion: "us-east-2",
    githubPagesDefaultDomain: "derploidentertainment.github.io",
    githubPagesDnsVerificationDomain: "_github-pages-challenge-DerploidEntertainment",
    githubOrgDnsVerificationDomain: "_github-challenge-derploidentertainment-organization.www",
    githubOrgDnsVerificationTxtValue: "1744185f3c",
    logBucketExpirationDays: 30,
};
const cfgSpecific = envName === "test"
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
const cfgSecret = envName === "test" ? testSecretEnv : prodSecretEnv;
const cfg = {
    ...cfgShared,
    ...cfgSpecific,
    ...cfgSecret,
};

// Validate/sanitize configuration
cfg.mainRootDomain = cfg.mainRootDomain.toLowerCase();
cfg.mainTLD = cfg.mainTLD.toLowerCase();
const redirectLowerCaseTLDs = cfg.redirectTLDs.split(",").map(x => x.toLowerCase());
const redirectHostedZoneIds: string[] = cfg.redirectHostedZoneIds.split(",");

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
    hostedZoneId: cfg.mainHostedZoneId,
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
    hostedZoneId: cfg.mainHostedZoneId,
});

// Set up DNS records and other resources for redirecting provided domains to the "main" domain, with DNSSEC
redirectLowerCaseTLDs
    .forEach((tld, index) => {
        const tldPascalCase = tld[0].toUpperCase() + tld.substring(1);
        const resourcePrefix: string = mainDomainPascalCase + tldPascalCase;
        const fqdn = `${cfg.mainRootDomain}.${tld}`;
        new WebsiteRedirectStack(app, resourcePrefix + "WebsiteRedirect", {
            env: cdkEnv,
            description: `Resources for redirecting the ${fqdn} to the organization website at ${mainFqdn}`,
            redirectApexDomain: fqdn,
            siteDomain: mainFqdn,
            hostedZoneId: redirectHostedZoneIds[index],
            logBucket: githubPagesOrganizationWebsiteStack.logBucket,
        });
        new DnssecStack(app, resourcePrefix + "Dnssec", {
            env: usEast1Env,
            description: `DNSSEC settings for ${fqdn}`,
            domainName: fqdn,
            hostedZoneId: redirectHostedZoneIds[index],
        });
    });
