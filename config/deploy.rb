set :application, "blocktogether"
set :repository,  "https://github.com/jsha/blocktogether.git"

set :scm, :git

set :deploy_to, "/usr/local/blocktogether"

set :deploy_via, :remote_cache
set :copy_exclude, [ '.git' ]

set :sequelize_config, "/etc/blocktogether/sequelize.json"

# Avoid an error becaues we don't have Rails'
# public/{images,javascripts,stylesheets} asset structure.
set :normalize_asset_timestamps, false

# Run cap staging deploy to deploy to staging.
task :staging do
  # Hostname blocktogether-staging is an IP alias in jsha's .ssh/config.
  role :app, *%w[ blocktogether-staging ]
end

task :production do
  role :app, *%w[ blocktogether ]
end

after "deploy:create_symlink" do
  run "cd #{current_path}; npm install -q"
  run "cd #{current_path}; js ./node_modules/.bin/sequelize --config #{sequelize_config} db:migrate"
  # Note: Have to cp instead of symlink since these must be root-owned.
  run "sudo cp #{current_path}/config/production/upstart/*.conf /etc/init/"
  run "sudo cp #{current_path}/config/nginx/sites-available/* /etc/nginx/sites-available"
end

namespace :deploy do
  task :restart do
    %w{
        blocktogether
        stream
        actions
        update-users
        update-blocks
    }.each do |name|
      sudo "service blocktogether-instance restart NAME=#{name}"
    end
    sudo "service nginx reload"
  end
end

before "deploy:setup" do
  dirs = %w{
          /etc/blocktogether
          /usr/local/blocktogether
          /usr/local/blocktogether/releases
          /data/mysql-backup
        }
  dirs.each do |dir|
    sudo "mkdir -p #{dir} -m 0755"
    sudo "chown ubuntu.ubuntu #{dir}"
  end
  ETC_BLOCKTOGETHER="/etc/blocktogether"
  upload "config/sequelize.json", "/tmp/sequelize.json", :mode => 0600
  upload "config/production.json", "/tmp/config.json", :mode => 0600
  run "cp -n /tmp/sequelize.json /tmp/config.json #{ETC_BLOCKTOGETHER}"
  upload "setup.sh", "#{ETC_BLOCKTOGETHER}/setup.sh", :mode => 0700
  run "#{ETC_BLOCKTOGETHER}/setup.sh"
end

after "deploy:setup" do
  sudo "chown -R ubuntu.ubuntu #{deploy_to}"
end
