# #!/bin/bash

# ******* WARNING *******
# This will clear any configuration (Twitter credentials, etc.) you have
# stored.
# ******* WARNING *******
#
sudo install -o "$USER" -d /etc/blocktogether
cp -a /vagrant/config/* /etc/blocktogether/
mv /etc/blocktogether/development.json /etc/blocktogether/config.json
