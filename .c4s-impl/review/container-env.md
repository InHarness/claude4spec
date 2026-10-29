# container-env — non-blocking review findings

- **rev-0002** `docker/entrypoint.sh:67`: on a 4xx refusal the script ran `exit 1` without `wait "$SERVER_PID"`. **Fixed in round 2**, together with blocking rev-0001: the default-port test no longer talks to 127.0.0.1:3000.
