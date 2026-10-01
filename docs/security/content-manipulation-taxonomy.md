<!-- markdownlint-disable MD013 -->

# Verus Content-Manipulation Taxonomy

Status: Approved baseline  
Version: v1  
Owner: Detection and security maintainers

The taxonomy defines the minimum classes that the Verus context firewall evaluates before content
can influence a trading or research agent. It is deliberately distinct from source credibility and
claim truthfulness: an authentic source can still contain unsafe instructions.

| Category                        | Default disposition | Threat mapping | Meaning                                                                   |
| ------------------------------- | ------------------- | -------------- | ------------------------------------------------------------------------- |
| `direct_instruction_override`   | block               | THR-ING-001    | Explicit attempts to replace agent instructions or safeguards.            |
| `indirect_instruction_override` | review              | THR-ING-001    | Instructions embedded in a document or contextual material.               |
| `tool_coercion`                 | block               | THR-ING-001    | Attempts to cause privileged tool invocation or execution.                |
| `encoded_payload`               | review              | THR-ING-002    | Encoded or fragmented content intended to evade inspection.               |
| `multilingual_instruction`      | review              | THR-ING-002    | Instructional content in another language.                                |
| `source_impersonation`          | block               | THR-ING-001    | False claims of trusted system or source authority.                       |
| `hidden_content`                | review              | THR-ING-002    | Material concealed in markup, layout, or non-visible text.                |
| `benign_control`                | allow               | —              | Ordinary financial or service information without agent-direction intent. |

The versioned [corpus](../../corpus/v1/README.md) supplies representative synthetic samples. Frozen
test samples are evaluation-only and cannot be used to tune detectors.
