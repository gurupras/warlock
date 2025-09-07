--
-- Extend the key if content is equal
--
-- KEYS[1]   - key
-- ARGV[1]   - ttl
-- ARGV[2]   - id
--
if redis.call("get", KEYS[1]) == ARGV[2] then
  return redis.call("pexpire", KEYS[1], ARGV[1])
else
  return 0
end
