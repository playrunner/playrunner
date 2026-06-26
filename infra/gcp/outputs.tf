output "repository_ids" {
  description = "Artifact Registry repository IDs by logical service"
  value = {
    for key, repo in google_artifact_registry_repository.repositories :
    key => repo.repository_id
  }
}

output "repository_urls" {
  description = "Artifact Registry URL prefixes by logical service"
  value = {
    for key, repo in google_artifact_registry_repository.repositories :
    key => "${repo.location}-docker.pkg.dev/${repo.project}/${repo.name}"
  }
}

output "workflow_events_topic_name" {
  description = "Pub/Sub topic name used for Playrunner workflow execution events"
  value       = google_pubsub_topic.workflow_events.name
}

output "workflow_events_topic_id" {
  description = "Fully-qualified Pub/Sub topic ID used for Playrunner workflow execution events"
  value       = google_pubsub_topic.workflow_events.id
}
