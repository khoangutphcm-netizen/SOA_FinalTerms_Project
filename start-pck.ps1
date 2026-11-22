param(
    [ValidateSet('Local', 'Ngrok', 'Docker', 'Stripe', 'Test')]
    [string]$Mode = 'Local',
    [int]$Port = 3100
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

switch ($Mode) {
    'Local' { npm start }
    'Ngrok' { npm run ngrok }
    'Docker' { docker compose up --build }
    'Stripe' {
        $endpoint = "http://127.0.0.1:$Port/api/stripe/webhook"
        stripe listen '--events=checkout.session.completed,checkout.session.async_payment_succeeded' --forward-to $endpoint
    }
    'Test' { node --test test/*.test.mjs }
}
exit $LASTEXITCODE
