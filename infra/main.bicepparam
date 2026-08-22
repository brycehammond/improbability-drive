// Every value the deployment needs, read from the environment with a working
// default. Nothing account-specific is written down here.
//
// A `.bicepparam` file has to assign every parameter itself: it cannot be
// combined with `--parameters name=value` on the command line. Reading the
// environment instead is what keeps the template configurable, and it keeps
// the API key off the command line and out of the process list entirely.
//
//   ANTHROPIC_API_KEY=sk-... APP_NAME=mydrive \
//     az deployment sub create --location westus2 \
//       --template-file infra/main.bicep --parameters infra/main.bicepparam
using './main.bicep'

param appName = readEnvironmentVariable('APP_NAME', 'improbabilitydrive')
param location = readEnvironmentVariable('AZURE_LOCATION', 'westus2')
param staticWebAppLocation = readEnvironmentVariable('SWA_LOCATION', 'westus2')
param resourceGroupName = readEnvironmentVariable('AZURE_RESOURCE_GROUP', 'improbabilitydrive-rg')
param skuName = readEnvironmentVariable('SWA_SKU', 'Free')
param model = readEnvironmentVariable('ANTHROPIC_MODEL', 'claude-opus-5')

// Empty is legal and deploys in mock mode: the function answers from a canned
// report and calls nothing.
param anthropicApiKey = readEnvironmentVariable('ANTHROPIC_API_KEY', '')

param tags = {
  application: 'improbability-drive'
  source: 'github.com/brycehammond/improbability-drive'
}
