'use strict'

const ARRAY_FIELDS = [
  'groups', 'chains', 'messages', 'schedules', 'scheduleschains',
  'schedulesmessages', 'shops', 'shopschains', 'shopsmessages', 'landings',
  'lists', 'listdata', 'global', 'external', 'webapp', 'webapprubric',
  'webappdata'
]

const EXPORT_FIELDS = ['groupnull', ...ARRAY_FIELDS]
const AUTO_FIELDS = ['ClientID', 'Messenger', 'BotID', 'CreationDate']
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024

module.exports = { ARRAY_FIELDS, EXPORT_FIELDS, AUTO_FIELDS, MAX_ARCHIVE_BYTES }
