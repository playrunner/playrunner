variable "project_id" {
  description = "The ID of the GCP project where the platform infrastructure resides (e.g., your central platform project)"
  type        = string
}

variable "region" {
  description = "The region to deploy the Artifact Registry repository"
  type        = string
}

variable "workflow_events_topic_name" {
  description = "Pub/Sub topic name used for Playrunner workflow execution events"
  type        = string
  default     = "playrunner-workflow-events"
}
