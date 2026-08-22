// The resources themselves, at resource-group scope.
//
// Two of them: a storage account holding the report history, and a Static Web
// App serving the site and hosting the one managed function. The function
// reaches the table with a connection string read out of the storage account
// at deploy time, so no key is ever typed by a human or committed anywhere.
//
// (Static Web Apps managed functions have no managed identity, which is why
// this is a connection string rather than a role assignment.)

@minLength(3)
@maxLength(20)
param appName string

param location string
param staticWebAppLocation string

@allowed([
  'Free'
  'Standard'
])
param skuName string

@secure()
param anthropicApiKey string

param model string
param tags object

// Storage account names are global, lowercase alphanumeric, and at most 24
// characters. uniqueString is deterministic for a given resource group, so
// redeploying finds the same account rather than making another one.
var storageAccountName = take('${toLower(replace(appName, '-', ''))}${uniqueString(resourceGroup().id)}', 24)
var tableName = 'reports'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // The managed function authenticates with the account key, so shared key
    // access has to stay on.
    allowSharedKeyAccess: true
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

// The app creates this table if it is missing, but creating it here means the
// first press of the button is not also the first write of a schema.
resource reportsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: tableName
}

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: appName
  location: staticWebAppLocation
  tags: tags
  sku: {
    name: skuName
    tier: skuName
  }
  properties: {
    // The site is built and uploaded by the workflow, not by Oryx on push, so
    // there is no repository wired up here.
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Enabled'
  }
}

// Application settings are the whole point of hosting the model call
// server-side: these reach the function's process environment and nothing else.
resource appSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    ANTHROPIC_API_KEY: anthropicApiKey
    MODEL: model
    TABLES_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
  }
}

output staticWebAppName string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname
output storageAccountName string = storage.name
output tableName string = reportsTable.name
