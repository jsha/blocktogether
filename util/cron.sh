#!/bin/bash -e
# Back up MySQL DB and delete backups older than 30 days
# and log files older than 7 days.
AUTH="-u blocktogether --password=XXXXXXXXXXX"
DB=blocktogether
TABLES="`mysql $AUTH -D $DB -e 'show tables' -B --skip-column-names`"
for TABLE in $TABLES; do
  mysqldump $AUTH \
    --single-transaction \
    "$DB" "$TABLE" | \
  gpg --encrypt --quiet -r f1faf31d > \
    /data/mysql-backups/"$TABLE".$(date +%Y%m%d).gpg
  # Clean up old backups
  find /data/mysql-backups/ -ctime +30 -exec rm {} \;
done

find /usr/local/blocktogether/shared/logs/ -ctime +7 -exec rm {} \;
