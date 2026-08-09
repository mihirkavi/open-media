import ExpoModulesCore

#if canImport(FoundationModels)
import FoundationModels
#endif

private struct SearchCandidate: Decodable {
  let id: String
  let title: String
  let text: String
}

#if canImport(FoundationModels)
@available(iOS 26.0, macOS 26.0, *)
@Generable
private struct RankedSearchResults {
  @Guide(description: "A concise sentence explaining how the selected messages answer the search")
  var summary: String

  @Guide(description: "Only candidate IDs supplied in the prompt, ordered from most to least relevant", .maximumCount(8))
  var ids: [String]
}
#endif

public class AppleFoundationSearchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleFoundationSearch")

    AsyncFunction("availabilityAsync") { () -> [String: Any] in
      #if canImport(FoundationModels)
      if #available(iOS 26.0, macOS 26.0, *) {
        switch SystemLanguageModel.default.availability {
        case .available:
          return ["available": true]
        case .unavailable(let reason):
          return ["available": false, "reason": String(describing: reason)]
        }
      }
      #endif
      return ["available": false, "reason": "requires-ios-26-and-apple-intelligence"]
    }

    AsyncFunction("searchAsync") { (query: String, candidatesJSON: String) async throws -> [String: Any] in
      let data = Data(candidatesJSON.utf8)
      let candidates = try JSONDecoder().decode([SearchCandidate].self, from: data)
      let allowedIDs = Set(candidates.map(\.id))

      #if canImport(FoundationModels)
      if #available(iOS 26.0, macOS 26.0, *) {
        guard SystemLanguageModel.default.isAvailable else {
          throw Exception(name: "ModelUnavailable", description: "Apple Intelligence is not available on this device.")
        }

        let compactCandidates = candidates.prefix(40).map {
          "ID: \($0.id)\nPerson: \($0.title)\nMessages: \($0.text.prefix(700))"
        }.joined(separator: "\n---\n")
        let session = LanguageModelSession(instructions: """
          You rank private message-search candidates. Never invent an ID. Select only supplied IDs.
          Prefer semantic intent, relevant commitments, people, places, dates, and message meaning.
          Return no candidate when none genuinely answers the search.
          """)
        let response = try await session.respond(
          to: "Search: \(query)\n\nCandidates:\n\(compactCandidates)",
          generating: RankedSearchResults.self
        )
        let safeIDs = response.content.ids.filter { allowedIDs.contains($0) }
        return ["ids": safeIDs, "summary": response.content.summary]
      }
      #endif

      throw Exception(name: "ModelUnavailable", description: "Apple Foundation Models requires iOS 26 or later.")
    }
  }
}
