// The whole of the Improbability Drive's infrastructure, from an empty
// subscription to a running site.
//
// Subscription-scoped so a single command provisions everything, including the
// resource group. Nothing here is specific to one account: every name is
// derived from `appName`, and every account-specific value is a parameter.
//
//   az deployment sub create \
//     --location westus2 \
//     --template-file infra/main.bicep \
//     --parameters infra/main.bicepparam \
//     --parameters anthropicApiKey="$ANTHROPIC_API_KEY"

targetScope = 'subscription'

@description('Base name for every resource. Lowercase letters and digits travel best.')
@minLength(3)
@maxLength(20)
param appName string = 'improbabilitydrive'

@description('Region for the resource group and the storage account.')
param location string = deployment().location

@description('Region for the Static Web App. Static Web Apps live in a short list of regions, which is why this is separate from `location`.')
@allowed([
  'westus2'
  'centralus'
  'eastus2'
  'westeurope'
  'eastasia'
])
param staticWebAppLocation string = 'westus2'

@description('Resource group to create or reuse.')
param resourceGroupName string = '${appName}-rg'

@description('Static Web Apps plan. Free is enough for a button; Standard adds SLA, private endpoints and more app settings.')
@allowed([
  'Free'
  'Standard'
])
param skuName string = 'Free'

@description('The Anthropic API key. Stored as a Static Web App application setting, which is server-side only: it is never served to a browser. Leave empty to deploy in mock mode, where the function answers from a canned report and calls nothing.')
@secure()
param anthropicApiKey string

@description('The Claude model the Drive asks for its reports.')
param model string = 'claude-opus-5'

@description('Tags applied to every resource.')
param tags object = {
  application: 'improbability-drive'
}

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  name: 'improbability-drive-resources'
  scope: rg
  params: {
    appName: appName
    location: location
    staticWebAppLocation: staticWebAppLocation
    skuName: skuName
    anthropicApiKey: anthropicApiKey
    model: model
    tags: tags
  }
}

@description('Pass to `swa deploy` and `az staticwebapp` commands.')
output staticWebAppName string = resources.outputs.staticWebAppName

@description('Where the site answers before a custom domain is bound.')
output defaultHostname string = resources.outputs.defaultHostname

output resourceGroupName string = rg.name
output storageAccountName string = resources.outputs.storageAccountName
output tableName string = resources.outputs.tableName
