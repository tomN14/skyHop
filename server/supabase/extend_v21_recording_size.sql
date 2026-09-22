-- Allow 25-minute campaign recordings (was 25 MB).
update storage.buckets
set file_size_limit = 268435456
where id = 'skyhop-recordings';
