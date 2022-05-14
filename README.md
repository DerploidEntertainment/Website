# Derploid Website

## Steps to set up website

1. Create stack from [website](./website.yaml) template. If domain already has HostedZone, then after stack's Route 53 HostedZone and ACM cert are created, update name servers associated with domain.
1. Create stack from [website-redirect](./website-redirect.yaml) template for each domain that should redirect to the website. If domains already have HostedZones, then after stacks' Route 53 HostedZones and ACM certs are created, update name servers associated with those domains.
1. If additional DNS record sets are needed for any of the above domains, then first use AWS CLI or REST API to [create a reusable delegation set](https://docs.aws.amazon.com/Route53/latest/APIReference/API_CreateReusableDelegationSet.html). That delegation set's ID can then be passed to new HostedZones so they can share the same name servers and thus combine record sets.
