set :application, "blocktogether"
set :user, "ubuntu"
set :repository,  "https://github.com/jsha/blocktogether.git"

set :scm, :git

set :deploy_to, "/data/blocktogether"

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

task :web do
  role :app, *%w[ web1.blocktogether.org   ]
  set :process_names, %w[ blocktogether ]
end

task :db do
  role :app, *%w[ btdb.blocktogether.org ]
  set :process_names, %w[ stream actions update-users update-blocks deleter ]
  after "deploy:create_symlink" do
    run "cd #{current_path}; NODE_ENV=production node ./node_modules/.bin/sequelize --config #{sequelize_config} db:migrate"
  end
end

after "deploy:create_symlink" do
  run "cd #{current_path}; npm install -q"
  # Note: Have to cp instead of symlink since these must be root-owned.
  run "sudo cp #{current_path}/config/production/upstart/blocktogether-instance.conf /etc/init/"
  run "sudo cp #{current_path}/config/nginx/sites-available/* /etc/nginx/sites-available"
  run "sudo ln -sf /etc/nginx/sites-available/* /etc/nginx/sites-enabled/"
end

namespace :deploy do
  task :restart do
    process_names.each do |name|
      sudo "service blocktogether-instance restart NAME=#{name}"
      # Only do nginx reloads on the web frontend.
      if name == "blocktogether"
        sudo "service nginx reload"
      end
    end
  end
end

before "deploy:setup" do
  dirs = %w{
          /etc/blocktogether
          /data/blocktogether
          /data/blocktogether/releases
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
