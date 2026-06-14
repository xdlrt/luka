## Summary

Describe the behavior change and why it is needed.

## Validation

- [ ] `npm run build`
- [ ] `npm test`
- [ ] Extra checks, if relevant:

## Safety And Protocol Checklist

- [ ] Tool definitions exposed to the model do not include runtime fields.
- [ ] Tool messages use the model-provided `tool_call.id`.
- [ ] Permission, path, command, or verification changes include rejection tests.
- [ ] Documentation only claims implemented capabilities.
- [ ] No credentials, `.env` files, tokens, or private environment dumps are included.

## Notes

Mention any tradeoffs, follow-up work, or intentionally unchanged behavior.
