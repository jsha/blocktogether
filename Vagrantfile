# -*- mode: ruby -*-
# vi: set ft=ruby :

# Vagrantfile API/syntax version. Don't touch unless you know what you're doing!
VAGRANTFILE_API_VERSION = "2"

Vagrant.configure("2") do |config|
  config.vm.box = "ubuntu/trusty32"
  config.vm.provision :shell, privileged: false, path: "bin/vagrant_up.sh"
  config.vm.network :forwarded_port, host: 3000, guest: 3000
end