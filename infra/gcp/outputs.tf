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

output "api_image_uri" {
  description = "Default Playrunner API image URI used by infra/gcp/scripts/push-runners.sh"
  value       = "${google_artifact_registry_repository.repositories["api"].location}-docker.pkg.dev/${google_artifact_registry_repository.repositories["api"].project}/${google_artifact_registry_repository.repositories["api"].name}/${var.api_image_name}:${var.api_image_tag}"
}

output "api_service_name" {
  description = "Cloud Run service name for the Playrunner API"
  value       = google_cloud_run_v2_service.api.name
}

output "api_service_uri" {
  description = "Public URL for the Playrunner API Cloud Run service"
  value       = google_cloud_run_v2_service.api.uri
}

output "workflow_events_topic_name" {
  description = "Pub/Sub topic name used for Playrunner workflow execution events"
  value       = google_pubsub_topic.workflow_events.name
}

output "workflow_events_topic_id" {
  description = "Fully-qualified Pub/Sub topic ID used for Playrunner workflow execution events"
  value       = google_pubsub_topic.workflow_events.id
}

output "scheduler_service_account_email" {
  description = "Service account email used by Cloud Scheduler OIDC HTTP targets"
  value       = google_service_account.scheduler.email
}
