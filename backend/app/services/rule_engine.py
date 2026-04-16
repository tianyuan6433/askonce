"""Pre-Claude rule engine for clarification decisions."""
from dataclasses import dataclass


@dataclass
class ClarificationQuestion:
    id: str
    text: str
    options: list[str]


@dataclass
class RuleEngineResult:
    should_force_clarify: bool = False
    should_force_answer: bool = False
    forced_questions: list[ClarificationQuestion] | None = None
    reason: str = ""


def evaluate_rules(
    confidence: float,
    retrieval_results: list,
    round_count: int,
    max_rounds: int,
    confidence_threshold: float,
) -> RuleEngineResult:
    # Rule 1: Max rounds reached — force direct answer, no more clarification
    if round_count >= max_rounds:
        return RuleEngineResult(
            should_force_answer=True,
            reason=f"Max clarification rounds reached ({max_rounds})",
        )

    # Rule 2: Zero knowledge matches — force clarification
    if len(retrieval_results) == 0:
        return RuleEngineResult(
            should_force_clarify=True,
            forced_questions=[
                ClarificationQuestion(
                    id="rule_q1",
                    text="I couldn't find a direct match in our knowledge base. Could you provide more details or rephrase your question?",
                    options=[
                        "Let me rephrase my question",
                        "I need help with device setup",
                        "I have a billing question",
                        "I need technical support",
                    ],
                )
            ],
            reason="No matching knowledge entries found",
        )

    # Rule 3: Low confidence — force clarification
    if confidence < confidence_threshold:
        return RuleEngineResult(
            should_force_clarify=True,
            forced_questions=[
                ClarificationQuestion(
                    id="rule_q1",
                    text="I found some related information but I'm not fully confident in the match. Could you help me narrow it down?",
                    options=[
                        "Show me what you found",
                        "Let me add more context",
                        "Try your best answer",
                    ],
                )
            ],
            reason=f"Low confidence ({confidence:.2f} < {confidence_threshold})",
        )

    # No rules triggered
    return RuleEngineResult(reason="All checks passed")
