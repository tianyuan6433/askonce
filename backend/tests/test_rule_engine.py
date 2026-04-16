import pytest
from app.services.rule_engine import evaluate_rules, RuleEngineResult


class TestRuleEngine:
    def test_high_confidence_no_force(self):
        result = evaluate_rules(
            confidence=0.95,
            retrieval_results=[{"id": "k1"}],
            round_count=0,
            max_rounds=3,
            confidence_threshold=0.60,
        )
        assert result.should_force_clarify is False
        assert result.should_force_answer is False

    def test_zero_matches_forces_clarify(self):
        result = evaluate_rules(
            confidence=0.0,
            retrieval_results=[],
            round_count=0,
            max_rounds=3,
            confidence_threshold=0.60,
        )
        assert result.should_force_clarify is True
        assert result.forced_questions is not None
        assert len(result.forced_questions) >= 1

    def test_low_confidence_forces_clarify(self):
        result = evaluate_rules(
            confidence=0.3,
            retrieval_results=[{"id": "k1"}],
            round_count=0,
            max_rounds=3,
            confidence_threshold=0.60,
        )
        assert result.should_force_clarify is True

    def test_max_rounds_forces_answer(self):
        result = evaluate_rules(
            confidence=0.3,
            retrieval_results=[],
            round_count=3,
            max_rounds=3,
            confidence_threshold=0.60,
        )
        assert result.should_force_answer is True
        assert result.should_force_clarify is False

    def test_max_rounds_overrides_low_confidence(self):
        result = evaluate_rules(
            confidence=0.1,
            retrieval_results=[],
            round_count=5,
            max_rounds=3,
            confidence_threshold=0.60,
        )
        assert result.should_force_answer is True
        assert result.should_force_clarify is False

    def test_first_round_low_confidence_with_results(self):
        result = evaluate_rules(
            confidence=0.45,
            retrieval_results=[{"id": "k1"}, {"id": "k2"}],
            round_count=1,
            max_rounds=3,
            confidence_threshold=0.60,
        )
        assert result.should_force_clarify is True
        assert result.reason != ""
