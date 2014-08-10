set :application, "blocktogether"
set :repository,  "https://github.com/jsha/blocktogether.git"

set :scm, :git

# Server hostname to deploy to.
role :app, "owb"
set :deploy_to, "/usr/local/blocktogether2"

# Avoid an error because we don't have Rails'
# public/{images,javascripts,stylesheets} asset structure.
set :normalize_asset_timestamps, false

after "deploy:create_symlink" do
  run "cd #{current_path}; npm install -q"
  run "cd #{current_path}; js ./node_modules/sequelize/bin/sequelize -m --config /etc/blocktogether/production/sequelize.json"
end
namespace :deploy do
  task :restart, :roles => :app do
    run "killall run-prod.sh js; #{current_path}/run-prod.sh"
  end
end
