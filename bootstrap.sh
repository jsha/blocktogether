# #!/bin/bash
sudo rm -rf /etc/blocktogether
sudo mkdir /etc/blocktogether
cp -r /vagrant/config/* /etc/blocktogether/
mv /etc/blocktogether/development.json /etc/blocktogether/config.json

cd /vagrant
source ./setup.sh
su - vagrant -c'source /vagrant/install_nvm.sh'

sudo chown -R vagrant /etc/blocktogether

echo "*********************** IMPORTANT ***********************"
echo ""
echo "Go to apps.twitter.com and register the app with READ/WRITE permissions."
echo "Get your consumerKey and consumerSecret and add them to the config file:"
echo ""
echo "     vagrant ssh && sudo vim /etc/blocktogether/config.json"
echo ""
echo "Afterwards, you can start the server from the VM with:"
echo ""
echo "     vagrant ssh && ./run.sh"
echo ""
echo "It can then be accessed "
echo "*********************** IMPORTANT ***********************"
