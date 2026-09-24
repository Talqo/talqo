UPDATE "generation_attempt"
SET "estimated_input_tokens" = (char_length("input_text") + 3) / 4;
