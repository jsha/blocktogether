set :application, "blocktogether"
set :repository,  "https://github.com/jsha/blocktogether.git"

set :scm, :git

# Server hostname to deploy to.
role :app, "owb"
role :staging, "blocktogether-staging"
set :deploy_to, "/usr/local/blocktogether"

set :deploy_via, :remote_cache
set :copy_exclude, [ '.git' ]

# Avoid an error becaues we don't have Rails'
# public/{images,javascripts,stylesheets} asset structure.
set :normalize_asset_timestamps, false

after "deploy:create_symlink" do
  run "cd #{current_path}; npm install -q"
  run "cd #{current_path}; js ./node_modules/.bin/sequelize --config /etc/blocktogether/sequelize.json -m"
  run "sudo ln -sf #{current_path}/config/production/upstart/*.conf /etc/init.d/"
  run "sudo service blocktogether restart"
end

after "deploy:setup" do
  sudo "chown -R ubuntu.ubuntu #{deploy_to}"
end

namespace :deploy do
  task :restart do
    run "killall run-prod.sh js; #{current_path}/run-prod.sh"
  end
end
