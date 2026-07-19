# Python workers inside the Node.js backend

The Node.js API owns authentication, persistence, GitLab access, progress state,
and HTTP responses. Python is used only as a bounded child-process compute layer.

## Runtime command

```bash
PYTHONPATH=python python3 -m repository_analysis
```

The process reads one JSON document from `stdin`, emits JSON-line progress and
error events to `stderr`, and writes exactly one final JSON document to `stdout`.

## Structure

```text
python/repository_analysis/
├── __main__.py       # process boundary only
├── pipeline.py       # ordered audit workflow
├── engine.py         # reusable stage and bounded-loop runner
├── stages.py         # AI audit passes
├── batching.py       # repository evidence batching
├── openai_client.py  # OpenAI transport, retries and exact errors
├── validation.py     # output/evidence validation
├── protocol.py       # stdout/stderr JSON protocol
├── settings.py       # local constant configuration
├── errors.py
└── utils.py
```

## Adding another loop

Use `PipelineRunner.run_loop` in `pipeline.py`. Each loop gets bounded input,
progress reporting, deterministic order, and the same process-level error path.
Do not create another `spawn()` implementation in a feature module.

## Credential warning

`settings.py` currently contains a key placeholder because local constant-based
configuration was requested. A real key must not be committed or baked into an
image used outside a private local environment.
