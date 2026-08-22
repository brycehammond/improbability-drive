// Defaults for this deployment. Change these to put the Drive in another
// account; `anthropicApiKey` is deliberately absent and is passed on the
// command line (or by the workflow, from a secret) so it never lands in git.
using './main.bicep'

param appName = 'improbabilitydrive'
param staticWebAppLocation = 'westus2'
param skuName = 'Free'
param model = 'claude-opus-5'
param tags = {
  application: 'improbability-drive'
  source: 'github.com/brycehammond/improbability-drive'
}
