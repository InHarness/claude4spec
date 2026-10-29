# container-env — non-blocking review findings

- **rev-0002** `docker/entrypoint.sh:67`: on a 4xx refusal the script runs `exit 1` without `wait "$SERVER_PID"`. The server is SIGKILLed while still shutting down, unlike the TERM/INT trap, which waits.
