set :application, "blocktogether"
set :repository,  "https://github.com/jsha/blocktogether.git"

set :scm, :git

# Server hostname to deploy to.
role :app, "owb"
set :deploy_to, "/usr/local/blocktogether2"

# Avoid an error becaues we don't have Rails'
# public/{images,javascripts,stylesheets} asset structure.
set :normalize_asset_timestamps, false
