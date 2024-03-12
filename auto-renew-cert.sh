#!/bin/sh

# Please add the following command line to /etc/crontab to automatically renew the certbot certificate.
# 0 0 * * * gini /usr/bin/bash $HOME/NVR/auto-renew-cert.sh

echo 87518499 | sudo -S /usr/bin/certbot renew --nginx > /dev/null 2>&1
echo 87518499 | sudo -S chown $(whoami) /etc/letsencrypt/live/ -R
echo 87518499 | sudo -S chown $(whoami) /etc/letsencrypt/archive/ -R
