export function generateServerService(config) {
    return `[Unit]
Description=AEBClawd API Server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=aebclawd
WorkingDirectory=${config.installDir}/apps/server
EnvironmentFile=${config.installDir}/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=aebclawd-server

[Install]
WantedBy=multi-user.target
`;
}
export function generateFrontendService(config) {
    return `[Unit]
Description=AEBClawd Frontend
After=aebclawd-server.service
Wants=aebclawd-server.service

[Service]
Type=simple
User=aebclawd
WorkingDirectory=${config.installDir}/apps/frontend
EnvironmentFile=${config.installDir}/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/npx next start -p 3000
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=aebclawd-frontend

[Install]
WantedBy=multi-user.target
`;
}
export function generateBotService(config) {
    return `[Unit]
Description=AEBClawd Bot
After=aebclawd-server.service
Wants=aebclawd-server.service

[Service]
Type=simple
User=aebclawd
WorkingDirectory=${config.installDir}/apps/bot
EnvironmentFile=${config.installDir}/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=aebclawd-bot

[Install]
WantedBy=multi-user.target
`;
}
