-- ADR 0008: preserve the pre-upgrade schedule even for a device that joins later.
-- Existing clients freeze their own legacy log in local migration 11. Sequence numbers
-- stay unchanged: no new answer was made, and existing clients already hold these entries.
WITH options AS (
  SELECT c.user_id, c.id AS card_id, json_object(
    'desiredRetention', COALESCE(json_extract(d.body, '$.record.fields.desiredRetention.value'), json_extract(p.body, '$.record.fields.desiredRetention.value')),
    'learningSteps', json(json_extract(p.body, '$.record.fields.learningSteps.value')),
    'fsrsParameters', json(COALESCE(json_extract(p.body, '$.record.fields.fsrsParameters.value'), '[0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542]'))
  ) AS body
  FROM sync_records c
  JOIN sync_records d ON d.user_id = c.user_id AND d.kind = 'decks'
    AND d.id = json_extract(c.body, '$.record.fields.deckId.value')
  JOIN sync_records p ON p.user_id = c.user_id AND p.kind = 'presets'
    AND p.id = json_extract(d.body, '$.record.fields.presetId.value')
  WHERE c.kind = 'cards'
)
UPDATE sync_records SET body = json_set(body, '$.entry.options', json((
  SELECT body FROM options WHERE user_id = sync_records.user_id
    AND card_id = json_extract(sync_records.body, '$.entry.cardId')
)))
WHERE kind = 'reviewLog' AND json_extract(body, '$.entry.kind') = 'review'
  AND json_extract(body, '$.entry.options') IS NULL
  AND EXISTS (SELECT 1 FROM options WHERE user_id = sync_records.user_id
    AND card_id = json_extract(sync_records.body, '$.entry.cardId'));
