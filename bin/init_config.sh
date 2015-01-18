# #!/bin/bash

# ******* WARNING *******
# This will clear any configuration (Twitter credentials, etc.) you have
# stored.
# ******* WARNING *******
#
sudo rm -rf /etc/blocktogether
sudo mkdir /etc/blocktogether
cp -r /vagrant/config/* /etc/blocktogether/
mv /etc/blocktogether/development.json /etc/blocktogether/config.json
