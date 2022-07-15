export function toPascalCase(str: string): string {
    return str[0].toLocaleUpperCase() + str.substring(1);
}

export function domainToPascalCase(domainName: string): string {
    return domainName.split(".").map(toPascalCase).join("");
}