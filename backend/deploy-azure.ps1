param(
  [string]$ResourceGroup = "wehealth-rg",
  [string]$Location = "eastus2",
  [string]$AppName = "wehealth-api-app",
  [string]$PlanName = "wehealth-plan",
  [string]$Sku = "B1"
)

# Requires: az login
# Usage:
#   ./deploy-azure.ps1 -AppName <unique-app-name>

Write-Host "Creating/updating resource group..."
az group create --name $ResourceGroup --location $Location | Out-Null

Write-Host "Creating/updating app service plan..."
az appservice plan create --name $PlanName --resource-group $ResourceGroup --location $Location --sku $Sku --is-linux | Out-Null

Write-Host "Creating/updating web app..."
az webapp create --resource-group $ResourceGroup --plan $PlanName --name $AppName --runtime "NODE|22-lts" | Out-Null

Write-Host "Configuring startup command..."
az webapp config set --resource-group $ResourceGroup --name $AppName --startup-file "npm start" | Out-Null

Write-Host "Configuring app settings..."
az webapp config appsettings set --resource-group $ResourceGroup --name $AppName --settings `
  NODE_ENV=production `
  SCM_DO_BUILD_DURING_DEPLOYMENT=true `
  WEBSITE_NODE_DEFAULT_VERSION=~22 | Out-Null

Write-Host "Deploying current backend folder via zip..."
$zipPath = Join-Path $PSScriptRoot "backend.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Push-Location $PSScriptRoot
Compress-Archive -Path * -DestinationPath $zipPath -Force
Pop-Location

az webapp deployment source config-zip --resource-group $ResourceGroup --name $AppName --src $zipPath | Out-Null

Write-Host "Done. URL: https://$AppName.azurewebsites.net"
