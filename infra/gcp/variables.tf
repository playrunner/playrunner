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

variable "api_service_name" {
  description = "Cloud Run service name for the Playrunner API"
  type        = string
  default     = "playrunner-api"
}

variable "api_image_name" {
  description = "Artifact Registry image name used by push-runners.sh for the Playrunner API"
  type        = string
  default     = "playrunner-api"
}

variable "api_image_tag" {
  description = "Default Artifact Registry image tag used by push-runners.sh for the Playrunner API"
  type        = string
  default     = "latest"
}

variable "api_bootstrap_image_uri" {
  description = "Initial public container image used only to create the API Cloud Run service before the Playrunner API image has been pushed"
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "api_container_port" {
  description = "Container port exposed by the Playrunner API Cloud Run service"
  type        = number
  default     = 8080
}

variable "api_min_instance_count" {
  description = "Minimum Cloud Run instances for the Playrunner API service"
  type        = number
  default     = 0
}

variable "api_max_instance_count" {
  description = "Maximum Cloud Run instances for the Playrunner API service"
  type        = number
  default     = 10
}

variable "api_cpu_idle" {
  description = "Whether the API Cloud Run service can idle CPU outside request processing"
  type        = bool
  default     = true
}

variable "api_ingress" {
  description = "Ingress policy for the API Cloud Run service"
  type        = string
  default     = "INGRESS_TRAFFIC_ALL"
}

variable "api_allow_unauthenticated" {
  description = "Whether the API Cloud Run service allows unauthenticated network invocation. App routes still enforce Playrunner bearer auth where required."
  type        = bool
  default     = true
}

variable "api_environment_variables" {
  description = "Environment variables injected into the API Cloud Run service, for example DATABASE_URL. Values are sensitive but are still stored in Terraform state."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "scheduler_service_account_id" {
  description = "Service account ID used by Cloud Scheduler to call Playrunner trigger endpoints"
  type        = string
  default     = "playrunner-scheduler"
}

variable "scheduler_service_account_users" {
  description = "IAM members allowed to create Cloud Scheduler jobs that act as the scheduler service account, for example user:you@example.com"
  type        = set(string)
  default     = []
}
