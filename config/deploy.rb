set :application, "blocktogether"
set :user, "ubuntu"
set :repository,  "https://github.com/jsha/blocktogether.git"

set :scm, :git

set :deploy_to, "/data/blocktogether"

set :deploy_via, :remote_cache
set :copy_exclude, [ '.git' ]

set :sequelize_config, "/etc/blocktogether/sequelize.json"

set :service_names, %w[ web3 web4 update-blocks update-users stream actions deleter db node_exporter ]

# Avoid an error becaues we don't have Rails'
# public/{images,javascripts,stylesheets} asset structure.
set :normalize_asset_timestamps, false

# Run cap staging deploy to deploy to staging.
task :staging do
  # Hostname blocktogether-staging is an IP alias in jsha's .ssh/config.
  role :app, *%w[ blocktogether-staging ]
end

task :web do
  role :app, *%w[ web3.blocktogether.org  ]
end

task :udb do
  role :app, *%w[ btudb.blocktogether.org   ]
end

task :db do
  role :app, *%w[ btdb2.blocktogether.org ]
  after "deploy:create_symlink" do
    run "cd #{current_path}; NODE_ENV=production node ./node_modules/.bin/sequelize --config #{sequelize_config} db:migrate"
  end
end

after "deploy:create_symlink" do
  run "cd #{current_path}; npm install -q --production"
  # Note: Have to cp instead of symlink since these must be root-owned.
  run "sudo rsync -lr #{current_path}/config/etc/ /etc/"
end

namespace :deploy do
  task :restart do
    service_names.each do |name|
      sudo "service #{name} restart"
      # Only do nginx reloads on the web frontends.
      if name in %w[ web3 web4 ]
        sudo "service nginx reload"
      end
    end
  end
end

before "deploy:setup" do
  dirs = %w{
          /etc/blocktogether/production
          /data/blocktogether
          /data/blocktogether/releases
          /data/mysql-backup
          /tmp/config
        }
  dirs.each do |dir|
    sudo "mkdir -p #{dir} -m 0755"
    sudo "chown ubuntu.ubuntu #{dir}"
  end
  ETC_BLOCKTOGETHER="/etc/blocktogether"
  upload "config/", "/tmp/config/", :recursive => true
  run "cp -n /tmp/config/sequelize.json #{ETC_BLOCKTOGETHER}"
  run "cp -n /tmp/config/production.json #{ETC_BLOCKTOGETHER}/config.json"
  run "cp -n /tmp/config/production/log4js.json #{ETC_BLOCKTOGETHER}/production/"
  run "sudo rsync -lr /tmp/config/etc/ /etc/"
  upload "bin/setup.sh", "#{ETC_BLOCKTOGETHER}/setup.sh", :mode => 0700
  run "sudo bash -c 'APPUSER=ubuntu #{ETC_BLOCKTOGETHER}/setup.sh'"
end

after "deploy:setup" do
  sudo "chown -R ubuntu.ubuntu #{deploy_to}"
end
