import { useState } from "react";

export default function AddOpenApiSource(props: {
  onComplete: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<"url" | "auth" | "confirm">("url");
  const [specUrl, setSpecUrl] = useState("");

  return (
    <div>
      <h3>Add OpenAPI Source</h3>

      {step === "url" && (
        <div>
          <label>
            Spec URL or paste content:
            <input
              type="text"
              value={specUrl}
              onChange={(e) => setSpecUrl((e.target as HTMLInputElement).value)}
              placeholder="https://api.example.com/openapi.json"
            />
          </label>
          <div>
            <button onClick={props.onCancel}>Cancel</button>
            <button onClick={() => setStep("auth")} disabled={!specUrl}>
              Next
            </button>
          </div>
        </div>
      )}

      {step === "auth" && (
        <div>
          <p>Configure authentication headers…</p>
          <div>
            <button onClick={() => setStep("url")}>Back</button>
            <button onClick={() => setStep("confirm")}>Next</button>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div>
          <p>Ready to add spec from: {specUrl}</p>
          <div>
            <button onClick={() => setStep("auth")}>Back</button>
            <button onClick={props.onComplete}>Add Source</button>
          </div>
        </div>
      )}
    </div>
  );
}
