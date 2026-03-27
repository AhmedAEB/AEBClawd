export function generateCaddyfile(config, hashedPassword) {
    const { domain: domainConfig, basicAuth } = config;
    const siteAddress = domainConfig.mode === "domain" ? domainConfig.domain : ":80";
    const autoHttpsDirective = domainConfig.mode === "ip-only" ? "\n\tauto_https off" : "";
    return `${siteAddress} {${autoHttpsDirective}
\tbasicauth * {
\t\t${basicAuth.username} ${hashedPassword}
\t}

\thandle /api/* {
\t\treverse_proxy localhost:3001
\t}
\thandle /ws/* {
\t\treverse_proxy localhost:3001
\t}
\thandle /health {
\t\treverse_proxy localhost:3001
\t}
\thandle {
\t\treverse_proxy localhost:3000
\t}
}
`;
}
