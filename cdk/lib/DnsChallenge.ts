export default class DnsChallenge {
    /**
     * Domain name of the DNS TXT record used by systems for DNS domain verification/authorization.
     */
    domain: string;

    /**
     * Value to use in the root domain's DNS TXT record for domain verification/authorization. Do NOT include surrounding quotes.
     * This value will be visible to any DNS client, so it need not be kept secret from version control.
     */
    txtValue: string;
}